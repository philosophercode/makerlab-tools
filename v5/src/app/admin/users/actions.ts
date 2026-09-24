"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getAuth } from "../../../lib/auth/config";
import { reconcileSuperAdminFloor } from "../../../lib/auth/floor-role";
import { resolveIdentityFromHeaders, type Identity } from "../../../lib/auth/identity";
import { can } from "../../../lib/auth/permissions";
import { isSuperAdminFloor } from "../../../lib/auth/super-admins";
import { recordAuditEvent, type NewAuditEvent } from "../../../lib/data/audit";
import { countUsersWithRole, findUserById, type UserRecord } from "../../../lib/data/users";
import { isOneOf, ROLES, type Role } from "../../../lib/db/schema/vocabulary";
import { ADMIN_ACTION_TIER, rateLimitAsync } from "../../../lib/rate-limit";
import {
  ADMIN_USERS_PATH,
  type AdminActionError,
  type AdminActionResult,
  type AdminActionWarning,
} from "./action-result";

/**
 * The two writes `/admin/users` performs (data platform design spec §5.2, §8).
 *
 * **Each one checks its own permission.** A server action is a POST endpoint
 * with a generated name: it is reachable without ever rendering the page that
 * offers it, so nothing it receives — and nothing about the page that rendered
 * the control — is evidence of anything (§8). The identity is resolved here,
 * `users.manage` is checked here, and the limiter runs here.
 *
 * **The write goes through the admin plugin, the reads do not.** `set-role`
 * and `ban-user` carry behaviour worth having (a ban deletes the person's
 * sessions, so they are signed out mid-visit rather than on expiry), and they
 * authorize against the same declaration `can()` does. The roster itself is
 * read straight from Postgres — see `src/lib/data/users.ts`.
 *
 * **Refusals are values, not exceptions.** Each action answers
 * `{ ok: false, error: <code> }` and the client island renders the matching
 * `next-intl` string. A thrown error in a server action reaches the browser as
 * a digest and an error boundary, which is the wrong shape for "you cannot
 * demote the floor address, and here is why" (§5.2).
 *
 * **And a change that lands without its audit event is a success with a
 * warning, not a failure.** The two writes are two statements and only the
 * first one is the change; see {@link record}.
 */

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

  const recorded = await record({
    actorUserId: identity.userId,
    action: "role.changed",
    subjectType: "user",
    subjectId: target.id,
    // Both halves: "became an admin" is not answerable later without the
    // "from", and that is the question an audit trail exists to answer.
    detail: { from: target.role, to: role },
  });

  revalidatePath(ADMIN_USERS_PATH);
  return { ok: true, role, ...warn(gateWarning, recorded) };
}

/**
 * Ban or unban one person.
 *
 * A ban deletes their sessions, so it bites immediately rather than on the next
 * page load — and `resolveIdentity` refuses a banned user anyway, so even a
 * cookie that outlived the sweep resolves to anonymous.
 *
 * The floor address cannot be banned, and neither can the last super admin;
 * banning yourself is refused here so the message is ours (the plugin refuses
 * it too, with an error code the page would have to translate).
 */
export async function setUserBanned(input: {
  userId: string;
  banned: boolean;
  reason?: string;
}): Promise<AdminActionResult> {
  const gate = await authorize();
  if (!gate.ok) return gate;
  const { identity, warning: gateWarning } = gate;

  const target = await findUserById(input.userId);
  if (!target) return { ok: false, error: "unknown_user" };
  if (target.banned === input.banned) {
    return { ok: true, banned: input.banned, ...warn(gateWarning) };
  }

  if (input.banned) {
    // Self-ban first: the plugin refuses it too, but with an error code the
    // page would have to translate, and this way the message is ours.
    if (target.id === identity.userId) return { ok: false, error: "self_ban" };
    // No "last super admin" check here, deliberately. Reaching this line means
    // somebody *else* holds `users.manage` — the caller — so banning this
    // account cannot leave the lab without one.
    if (isSuperAdminFloor(target.email)) return { ok: false, error: "protected_floor" };
  }

  const reason = (input.reason ?? "").trim() || undefined;

  try {
    const auth = await getAuth();
    if (!auth) return { ok: false, error: "failed" };
    const requestedHeaders = await requestHeaders();
    if (input.banned) {
      await auth.api.banUser({
        body: { userId: target.id, ...(reason ? { banReason: reason } : {}) },
        headers: requestedHeaders,
      });
    } else {
      await auth.api.unbanUser({
        body: { userId: target.id },
        headers: requestedHeaders,
      });
    }
  } catch (err) {
    console.error("[admin/users] ban-user failed", err);
    return { ok: false, error: "failed" };
  }

  const recorded = await record({
    actorUserId: identity.userId,
    action: "user.banned",
    subjectType: "user",
    subjectId: target.id,
    // `AUDIT_ACTIONS` has no `user.unbanned` (spec §4.11), so lifting a ban is
    // the same action with `banned: false`. The alternative is a vocabulary
    // that drifts from the spec, which is worse than a flag in the detail.
    detail: { banned: input.banned, ...(reason ? { reason } : {}) },
  });

  revalidatePath(ADMIN_USERS_PATH);
  return {
    ok: true,
    banned: input.banned,
    ...warn(gateWarning, recorded),
  };
}

// ── The shared preamble ─────────────────────────────────────────────

type Gate =
  | { ok: true; identity: Identity; warning?: AdminActionWarning }
  | { ok: false; error: AdminActionError };

/**
 * Resolve the caller, bound their attempts, and check `users.manage`.
 *
 * Bounded *before* the permission check and the queries behind it (Article 4,
 * §8: 120/min per user), and keyed on `rateLimitKey` — the user id when signed
 * in, a hashed IP when not — so an anonymous prodder cannot spend an admin's
 * allowance.
 *
 * The last step is the one that is not a refusal: the floor is written onto the
 * caller's own row before either action calls the plugin. `can()` honours the
 * floor and the plugin does not — see `lib/auth/floor-role.ts` — so without
 * this a floor address whose row says `user` reaches the page with every
 * control live and every save failing. It runs after the permission check, so
 * only somebody the app already treats as a director can trigger it, and it is
 * a no-op for everyone whose row already agrees.
 */
async function authorize(): Promise<Gate> {
  const identity = await resolveIdentityFromHeaders();

  const { allowed } = await rateLimitAsync(
    `admin-action:${identity.rateLimitKey}`,
    ADMIN_ACTION_TIER
  );
  if (!allowed) return { ok: false, error: "rate_limited" };

  // Told apart on purpose: "sign in" is actionable and "you are not permitted"
  // is not, and showing the wrong one of those is how a page feels broken.
  if (identity.role === "anonymous") return { ok: false, error: "not_signed_in" };
  if (!can(identity, "users.manage")) return { ok: false, error: "not_permitted" };

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

// ── Recording it ────────────────────────────────────────────────────

/** The one warning either action can carry. Named so the two cannot drift. */
const AUDIT_WARNING: AdminActionWarning = "audit_unavailable";

/**
 * Write the audit event, and say whether it landed.
 *
 * **The order is not negotiable and neither is the shape.** The event describes
 * a change that has already committed — `auth.api.setRole` / `banUser` have
 * returned — and `recordAuditEvent` throws on any database failure. With the
 * Neon HTTP driver each statement is its own request, so a transient 5xx
 * between the two is an ordinary outcome rather than an exotic one, and there
 * is no transaction spanning them to roll back.
 *
 * Letting the throw propagate would reach the island as a rejected action, and
 * both islands answer a rejection by restoring the previous value: the page
 * would show the old role over a database holding the new one, which is exactly
 * what `RoleSelect`'s comment says it never does. Swallowing it silently would
 * leave a gap in the trail nobody was told about (spec §4.11).
 *
 * So the failure becomes a `warning` on a successful result: the row changed,
 * the page says so, and it also says the change was not recorded. The console
 * line is the operator's copy — it is the only place the event now exists.
 */
/**
 * The warning half of a successful result, or nothing.
 *
 * Two audit writes can go missing on one action — the floor reconciliation's,
 * before the action ran, and the action's own — and there is one warning for
 * both, because the admin's question is the same either way: *did the trail
 * record this?* Spread into the result so a success without a gap carries no
 * `warning` key at all.
 */
function warn(
  gateWarning: AdminActionWarning | undefined,
  recorded = true
): { warning?: AdminActionWarning } {
  const warning = gateWarning ?? (recorded ? undefined : AUDIT_WARNING);
  return warning ? { warning } : {};
}

async function record(event: NewAuditEvent): Promise<boolean> {
  try {
    await recordAuditEvent(event);
    return true;
  } catch (err) {
    console.error("[admin/users] audit write failed after the change landed", err);
    return false;
  }
}
