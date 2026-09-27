"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { authorizeAdminAction } from "../../../lib/admin/action-gate";
import { AUDIT_WARNING, record, warn } from "../../../lib/admin/audit-warning";
import { getAuth } from "../../../lib/auth/config";
import { isSignUpBlocked } from "../../../lib/auth/blocked-sign-in";
import { reconcileSuperAdminFloor } from "../../../lib/auth/floor-role";
import { type Identity } from "../../../lib/auth/identity";
import { isAllowedEmail, normalizeEmail } from "../../../lib/auth/roles";
import { isSuperAdminFloor } from "../../../lib/auth/super-admins";
import { unblockEmail } from "../../../lib/data/blocked-emails";
import { addPersonAccount } from "../../../lib/data/user-add";
import { removeUserAccount } from "../../../lib/data/user-removal";
import { countUsersWithRole, findUserById, updateUserTitle, type UserRecord } from "../../../lib/data/users";
import { isOneOf, ROLES, type Role } from "../../../lib/db/schema/vocabulary";
import { requestMirrorPush } from "../../../lib/mirror/trigger";
import { renamePerson } from "../../../lib/people/rename";
import { normalizeTitle } from "../../../lib/people/title";
import {
  ADMIN_USERS_PATH,
  PERSON_NAME_MAX_LENGTH,
  type AddPersonInput,
  type AddPersonResult,
  type AdminActionError,
  type AdminActionResult,
  type AdminActionWarning,
  type RemoveUserResult,
  type SetNameResult,
  type SetTitleResult,
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

/**
 * Set or clear one person's title. Blank (or null) clears it, and the People
 * page and profile menu go back to the role's default label.
 *
 * Refuses, in this order: the gate (signed in, rate, `users.manage`), a title
 * that is not text or is too long once trimmed, and an unknown target. The
 * floor is not consulted: a title grants nothing, so there is nothing about a
 * director's own label worth protecting from another director.
 *
 * Saving the title the person already has is a no-op success with no audit
 * event, like a role change to the same role.
 */
export async function setUserTitle(input: {
  userId: string;
  title: string | null;
}): Promise<SetTitleResult> {
  const gate = await authorize();
  if (!gate.ok) return gate;
  const { identity, warning: gateWarning } = gate;

  const normalized = normalizeTitle(input.title);
  if (!normalized.ok) return { ok: false, error: "invalid_title" };
  const { title } = normalized;

  const target = await findUserById(input.userId);
  if (!target) return { ok: false, error: "unknown_user" };
  if (target.title === title) return { ok: true, title, ...warn(gateWarning) };

  try {
    // Removed between the read above and this write: the same answer as never
    // having existed.
    if (!(await updateUserTitle(target.id, title))) return { ok: false, error: "unknown_user" };
  } catch (err) {
    console.error("[admin/users] set-title failed", err);
    return { ok: false, error: "failed" };
  }

  const recorded = await record(
    {
      actorUserId: identity.userId,
      action: "user.title_changed",
      subjectType: "user",
      subjectId: target.id,
      detail: { from: target.title, to: title },
    },
    AUDIT_SURFACE
  );

  revalidatePath(ADMIN_USERS_PATH);
  return { ok: true, title, ...warn(gateWarning, recorded) };
}

/**
 * Change anybody's display name — **Edit name** on the roster.
 *
 * Refuses, in this order: the gate (signed in, rate, `users.manage`), a name
 * that is blank or longer than `PERSON_NAME_MAX_LENGTH` once trimmed, and an
 * unknown target. The floor is not consulted: a name grants nothing. The
 * write and its `user.name_changed` event are `renamePerson`, shared with
 * `/account`, where people rename themselves.
 *
 * A name set here sticks: Google never overwrites it at a later sign-in
 * (`lib/auth/provider-name.ts`).
 */
export async function setUserName(input: { userId: string; name: string }): Promise<SetNameResult> {
  const gate = await authorize();
  if (!gate.ok) return gate;
  const { identity, warning: gateWarning } = gate;

  const result = await renamePerson({
    actorUserId: identity.userId,
    targetUserId: typeof input.userId === "string" ? input.userId : "",
    name: input.name,
    surface: AUDIT_SURFACE,
  });
  if (!result.ok) return result;

  // No mirror push: the mirror carries the name snapshots written with each
  // ticket and project, not the live `user.name`.
  if (result.changed) revalidatePath(ADMIN_USERS_PATH);
  return { ok: true, name: result.name, ...warn(gateWarning, result.audited) };
}

/** Good enough to refuse a typo; Google is what proves the address is real. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Add somebody before they have signed in: a `user` row with the role and
 * title given here, shown as "Not signed in yet" until their first Google
 * sign-in links to it (`account.accountLinking` in `lib/auth/config.ts`).
 *
 * Refuses, in this order: the gate (signed in, rate, `users.manage`), an
 * address that is not one, a name or title that is too long, a role outside
 * the vocabulary, an address the domain rule would refuse at sign-in
 * (`isAllowedEmail` — the same check the create hook runs), a blocked address
 * (the floor is never blocked), and an address that already has a row.
 *
 * **The floor wins, as at sign-in.** An address in `AUTH_SUPER_ADMIN_EMAILS`
 * is stored as `super_admin` whatever role was chosen — the create hook would
 * have done the same, and a row that disagrees with the floor is what
 * `reconcileSuperAdminFloor` exists to repair.
 *
 * The row and its `user.added` event are one transaction
 * (`lib/data/user-add.ts`), so a success has no audit gap of its own.
 */
export async function addPerson(input: AddPersonInput): Promise<AddPersonResult> {
  const gate = await authorize();
  if (!gate.ok) return gate;
  const { identity, warning: gateWarning } = gate;

  const email = normalizeEmail(input.email);
  if (!EMAIL_SHAPE.test(email)) return { ok: false, error: "invalid_email" };

  const typedName = typeof input.name === "string" ? input.name.replace(/\s+/g, " ").trim() : "";
  if (typedName.length > PERSON_NAME_MAX_LENGTH) return { ok: false, error: "invalid_name" };

  const normalizedTitle = normalizeTitle(input.title ?? null);
  if (!normalizedTitle.ok) return { ok: false, error: "invalid_title" };

  if (!isOneOf(ROLES, input.role)) return { ok: false, error: "invalid_role" };
  const role: Role = isSuperAdminFloor(email) ? "super_admin" : input.role;

  if (!isAllowedEmail(email)) return { ok: false, error: "email_not_allowed" };

  let result;
  try {
    if (await isSignUpBlocked(email)) return { ok: false, error: "email_blocked" };
    result = await addPersonAccount({
      email,
      // The address is the honest placeholder when nobody typed a name, and
      // the only name Google's replaces at their first sign-in; a typed one
      // is kept (`lib/auth/provider-name.ts`).
      name: typedName || email,
      role,
      title: normalizedTitle.title,
      actorUserId: identity.userId,
    });
  } catch (err) {
    console.error("[admin/users] add-person failed", err);
    return { ok: false, error: "failed" };
  }
  if (!result.ok) return result;

  revalidatePath(ADMIN_USERS_PATH);
  const { person } = result;
  return {
    ok: true,
    person: { id: person.id, name: person.name, email: person.email, role: person.role, title: person.title },
    ...warn(gateWarning),
  };
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
