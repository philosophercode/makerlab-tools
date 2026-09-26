"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { authorizeAdminAction } from "../../../lib/admin/action-gate";
import { AUDIT_WARNING, record, warn } from "../../../lib/admin/audit-warning";
import { getAuth } from "../../../lib/auth/config";
import { reconcileSuperAdminFloor } from "../../../lib/auth/floor-role";
import { type Identity } from "../../../lib/auth/identity";
import { isSuperAdminFloor } from "../../../lib/auth/super-admins";
import { unblockEmail } from "../../../lib/data/blocked-emails";
import { removeUserAccount } from "../../../lib/data/user-removal";
import { countUsersWithRole, findUserById, type UserRecord } from "../../../lib/data/users";
import { isOneOf, ROLES, type Role } from "../../../lib/db/schema/vocabulary";
import { requestMirrorPush } from "../../../lib/mirror/trigger";
import {
  ADMIN_USERS_PATH,
  type AdminActionError,
  type AdminActionResult,
  type AdminActionWarning,
  type RemoveUserResult,
  type UnblockEmailResult,
} from "./action-result";

/**
 * The writes `/admin/users` performs (data platform design spec §5.2, §8; auth
 * spec amendment 2026-09-25 for Remove and Unblock, which replaced Ban).
 *
 * **Each one checks its own permission.** A server action is a POST endpoint
 * with a generated name: it is reachable without ever rendering the page that
 * offers it, so nothing it receives — and nothing about the page that rendered
 * the control — is evidence of anything (§8). The identity is resolved here,
 * `users.manage` is checked here, and the limiter runs here.
 *
 * **A role change goes through the admin plugin; removal does not.** `set-role`
 * authorizes against the same declaration `can()` does. Removal is one
 * transaction the app owns (`lib/data/user-removal.ts`) — snapshots,
 * revocations, the delete, the optional block and the audit events together —
 * which the plugin's `remove-user` could not give. The roster itself is read
 * straight from Postgres — see `src/lib/data/users.ts`.
 *
 * **Refusals are values, not exceptions.** Each action answers
 * `{ ok: false, error: <code> }` and the client island renders the matching
 * `next-intl` string. A thrown error in a server action reaches the browser as
 * a digest and an error boundary, which is the wrong shape for "you cannot
 * demote the floor address, and here is why" (§5.2).
 *
 * **And a change that lands without its audit event is a success with a
 * warning, not a failure.** The two writes are two statements and only the
 * first one is the change; `record` and `warn` come from
 * `src/lib/admin/audit-warning.ts`, which every admin surface shares.
 */

/** Names this surface in the console line a missing audit event leaves behind. */
const AUDIT_SURFACE = "admin/users";

/**
 * Change one person's role.
 *
 * Refuses, in this order: an anonymous caller, the rate ceiling, a caller
 * without `users.manage`, a role outside the vocabulary, an unknown target, the
 * super-admin floor, and a demotion that would leave nobody holding
 * `super_admin` at all (spec §10, "the last super admin demotes themselves").
 *
 * A change to the role the person already has is a no-op that reports success
 * and writes no audit event — the trail records changes, and "admin → admin"
 * is not one.
 */
export async function setUserRole(input: {
  userId: string;
  role: string;
}): Promise<AdminActionResult> {
  const gate = await authorize();
  if (!gate.ok) return gate;
  // `gateWarning` is the reconciliation's own audit gap, if it had one. It
  // rides on every success below, including the ones that change nothing here:
  // the caller's row still moved.
  const { identity, warning: gateWarning } = gate;

  if (!isOneOf(ROLES, input.role)) return { ok: false, error: "invalid_role" };
  const role: Role = input.role;

  const target = await findUserById(input.userId);
  if (!target) return { ok: false, error: "unknown_user" };
  if (target.role === role) return { ok: true, role, ...warn(gateWarning) };

  const protection = await demotionProtection(target, role);
  if (protection) return { ok: false, error: protection };

  try {
    const auth = await getAuth();
    if (!auth) return { ok: false, error: "failed" };
    await auth.api.setRole({
      body: { userId: target.id, role },
      headers: await requestHeaders(),
    });
  } catch (err) {
    // The plugin refuses with an `APIError`; anything else is a database or
    // configuration problem. Either way the row did not change, and the caller
    // is told that rather than being shown a success they did not get.
    console.error("[admin/users] set-role failed", err);
    return { ok: false, error: "failed" };
  }

  const recorded = await record(
    {
      actorUserId: identity.userId,
      action: "role.changed",
      subjectType: "user",
      subjectId: target.id,
      // Both halves: "became an admin" is not answerable later without the
      // "from", and that is the question an audit trail exists to answer.
      detail: { from: target.role, to: role },
    },
    AUDIT_SURFACE
  );

  revalidatePath(ADMIN_USERS_PATH);
  return { ok: true, role, ...warn(gateWarning, recorded) };
}

/** The longest block reason kept; the field is a note, not a document. */
const BLOCK_REASON_MAX = 200;

/**
 * Remove one person, and optionally block their address (auth spec amendment
 * 2026-09-25, "Remove a person, and block an address").
 *
 * Refuses, in this order: the gate (signed in, rate, `users.manage`), an
 * unknown target, removing yourself, and a floor address — then the data layer
 * refuses the last super admin under a lock. The removal itself is one
 * transaction with its audit events inside it, so a success here has no audit
 * gap of its own; `gateWarning` is only the floor reconciliation's.
 *
 * A removal changes what the Notion mirror carries (an assignee's or author's
 * email goes), so a push is requested after it commits — which never throws.
 */
export async function removeUser(input: {
  userId: string;
  block: boolean;
  reason?: string;
}): Promise<RemoveUserResult> {
  const gate = await authorize();
  if (!gate.ok) return gate;
  const { identity, warning: gateWarning } = gate;

  const target = await findUserById(input.userId);
  if (!target) return { ok: false, error: "unknown_user" };
  if (target.id === identity.userId) return { ok: false, error: "self_remove" };
  // The floor can be neither removed nor blocked: it is the lock-out guarantee.
  if (isSuperAdminFloor(target.email)) return { ok: false, error: "protected_floor" };

  const reason = (input.reason ?? "").trim().slice(0, BLOCK_REASON_MAX) || null;

  let result;
  try {
    result = await removeUserAccount({
      userId: target.id,
      actorUserId: identity.userId,
      block: input.block ? { reason } : null,
    });
  } catch (err) {
    // The transaction rolled back: nothing was removed, blocked or recorded.
    console.error("[admin/users] remove-user failed", err);
    return { ok: false, error: "failed" };
  }
  if (!result.ok) return result;

  await requestMirrorPush();
  revalidatePath(ADMIN_USERS_PATH);
  return {
    ok: true,
    removed: { id: result.removed.id, name: result.removed.name, email: result.removed.email },
    blocked: result.blocked,
    ...warn(gateWarning),
  };
}

/**
 * Take an address off the blocked list, so it may sign up again — as a new
 * account with the default role. One transaction with its `email.unblocked`
 * event; an address that is not on the list is a no-op success.
 */
export async function unblockBlockedEmail(input: { email: string }): Promise<UnblockEmailResult> {
  const gate = await authorize();
  if (!gate.ok) return gate;
  const { identity, warning: gateWarning } = gate;

  const email = (input.email ?? "").trim().toLowerCase();
  try {
    await unblockEmail({ email, actorUserId: identity.userId });
  } catch (err) {
    console.error("[admin/users] unblock failed", err);
    return { ok: false, error: "failed" };
  }

  revalidatePath(ADMIN_USERS_PATH);
  return { ok: true, email, ...warn(gateWarning) };
}

// ── The shared preamble ─────────────────────────────────────────────

type Gate =
  | { ok: true; identity: Identity; warning?: AdminActionWarning }
  | { ok: false; error: AdminActionError };

/**
 * Resolve the caller, bound their attempts, check `users.manage` — and then
 * do the one thing that is this page's alone.
 *
 * The first three are {@link authorizeAdminAction}, shared with every other
 * admin surface. The last step is the one that is not a refusal: the floor is written onto the
 * caller's own row before either action calls the plugin. `can()` honours the
 * floor and the plugin does not — see `lib/auth/floor-role.ts` — so without
 * this a floor address whose row says `user` reaches the page with every
 * control live and every save failing. It runs after the permission check, so
 * only somebody the app already treats as a director can trigger it, and it is
 * a no-op for everyone whose row already agrees.
 */
async function authorize(): Promise<Gate> {
  // Identity, limiter, then the permission — the sequence every admin action
  // shares, which is why it lives in `src/lib/admin/action-gate.ts` now rather
  // than here. Only the step below it is this page's own.
  const gate = await authorizeAdminAction("users.manage");
  if (!gate.ok) return gate;
  const { identity } = gate;

  let reconciliation;
  try {
    reconciliation = await reconcileSuperAdminFloor(identity);
  } catch (err) {
    // The write that follows depends on this having landed, so reporting
    // "failed" is the honest answer — better than letting the plugin refuse
    // for a reason the page cannot explain.
    console.error("[admin/users] super-admin floor reconciliation failed", err);
    return { ok: false, error: "failed" };
  }

  // The reconciliation may have promoted this caller — and lifted a ban — with
  // no trail. That rides back as a warning on whatever the action goes on to
  // do, because refusing here would deny a change the database has kept.
  return {
    ok: true,
    identity,
    ...(reconciliation.audited ? {} : { warning: AUDIT_WARNING }),
  };
}

/**
 * Why `target` may not be moved to `nextRole`, or null when they may.
 *
 * Only demotions are protected — promoting anybody, including a floor address
 * that already holds the role, is always fine. Two guarantees, and they are
 * not the same one:
 *
 * - **The floor.** An address in `AUTH_SUPER_ADMIN_EMAILS` resolves
 *   `super_admin` whatever its row says, so demoting it in the database would
 *   produce a row that disagrees with the running app — confusing rather than
 *   dangerous, and worth refusing plainly.
 * - **The last super admin.** A deployment with no floor configured — a
 *   preview, a fork — can genuinely lock itself out, and this is the case spec
 *   §10 names. Banned super admins do not count towards "somebody is left":
 *   they resolve to anonymous and can undo nothing.
 */
async function demotionProtection(
  target: UserRecord,
  nextRole: Role
): Promise<AdminActionError | null> {
  if (nextRole === "super_admin") return null;

  if (isSuperAdminFloor(target.email)) return "protected_floor";

  if (target.role === "super_admin") {
    const remaining = await countUsersWithRole("super_admin", {
      excludeUserId: target.id,
    });
    if (remaining === 0) return "last_super_admin";
  }

  return null;
}

/**
 * The incoming request's headers as a real `Headers`.
 *
 * Better Auth iterates what it is given and `next/headers` returns a read-only
 * look-alike, so this copies rather than casts. Only the cookie is needed:
 * `set-role` is `requireHeaders: true` and authenticates from the session.
 */
async function requestHeaders(): Promise<Headers> {
  const incoming = await headers();
  const copy = new Headers();
  const cookie = incoming.get("cookie");
  if (cookie) copy.set("cookie", cookie);
  return copy;
}
