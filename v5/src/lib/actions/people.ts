import "server-only";

import { headers } from "next/headers";
import { z } from "zod";
import { ADMIN_USERS_PATH, type AdminActionError } from "../../app/admin/users/action-result";
import { record } from "../admin/audit-warning";
import { getAuth } from "../auth/config";
import { isSuperAdminFloor } from "../auth/super-admins";
import { countUsersWithRole, findUserById, updateUserTitle, type UserRecord } from "../data/users";
import { isOneOf, ROLES, type Role } from "../db/schema/vocabulary";
import { normalizeName } from "../people/name";
import { renamePerson } from "../people/rename";
import { normalizeTitle } from "../people/title";
import { defineAction } from "./define";
import { reconcileFloorAfterGate } from "./people-gate";

/**
 * Who someone is: role, title, name (spec §4.7 #44–45, and **Edit name**,
 * which arrived after the inventory with PR #92). Moved verbatim from
 * `app/admin/users/actions.ts`, whose exports are now one-line wrappers.
 *
 * `users.manage` on every surface, then the floor reconciliation, then the
 * action's own refusals in the order the page always gave them. Never over MCP
 * (§3.8): a leaked token must not be able to change who is who.
 */

/** Names this surface in the console line a missing audit event leaves behind. */
const AUDIT_SURFACE = "admin/users";

type PeopleError = Exclude<AdminActionError, "not_signed_in" | "not_permitted" | "rate_limited">;

// ── people.set_role ─────────────────────────────────────────────────

/**
 * Change one person's role. Refuses a role outside the vocabulary, an unknown
 * target, the super-admin floor, and a demotion that would leave nobody holding
 * `super_admin` (spec §10). A change to the role they already hold is a no-op
 * success with no audit event — the trail records changes.
 */
export const PEOPLE_SET_ROLE = defineAction<
  { userId: string; role: string },
  { role: Role },
  PeopleError,
  { from: Role; to: Role }
>({
  id: "people.set_role",
  toolName: "set_person_role",
  description:
    "Change one person's role (User, Admin or Super admin). Proposes the change; nothing changes until the person confirms it on the card.",
  permission: "users.manage",
  risk: "people",
  input: z.object({ userId: z.string(), role: z.string() }),
  invalidInput: "invalid_role",
  subject: (input) => ({ type: "user", id: input.userId }),
  afterGate: reconcileFloorAfterGate,
  check: async (input) => {
    if (!isOneOf(ROLES, input.role)) return "invalid_role";
    const target = await findUserById(input.userId);
    if (!target) return "unknown_user";
    if (target.role === input.role) return null;
    return demotionProtection(target, input.role);
  },
  run: async (input, ctx) => {
    const role = input.role as Role;
    const target = await findUserById(input.userId);
    if (!target) return { ok: false, error: "unknown_user" };
    if (target.role === role) return { ok: true, value: { role } };
    const protection = await demotionProtection(target, role);
    if (protection) return { ok: false, error: protection };

    try {
      const auth = await getAuth();
      if (!auth) return { ok: false, error: "failed" };
      const cookie = await requestHeaders();
      // The plugin authenticates from the request's cookie, not from the
      // identity `performAction` gated. They are the same person on every
      // surface today; this makes that a rule, so a confirm route or any
      // non-request caller can never gate one person and write as another.
      const session = await auth.api.getSession({ headers: cookie });
      if (!session || session.user.id !== ctx.identity.userId) {
        console.error("[admin/users] set-role refused: request session is not the gated identity");
        return { ok: false, error: "not_permitted" };
      }
      await auth.api.setRole({ body: { userId: target.id, role }, headers: cookie });
    } catch (err) {
      // The plugin refuses with an `APIError`; anything else is a database or
      // configuration problem. Either way the row did not change.
      console.error("[admin/users] set-role failed", err);
      return { ok: false, error: "failed" };
    }
    return { ok: true, value: { role }, committed: { from: target.role, to: role } };
  },
  afterCommit: async (input, { from, to }, ctx) => {
    const recorded = await record(
      {
        actorUserId: ctx.identity.userId,
        action: "role.changed",
        subjectType: "user",
        subjectId: input.userId,
        // Both halves: "became an admin" is not answerable later without the "from".
        detail: { from, to },
      },
      AUDIT_SURFACE
    );
    return recorded ? undefined : "audit_unavailable";
  },
  revalidate: [ADMIN_USERS_PATH],
});

// ── people.set_title ────────────────────────────────────────────────

/**
 * Set or clear one person's title. Blank or null clears it (back to the role's
 * default label). The floor is not consulted: a title grants nothing.
 */
export const PEOPLE_SET_TITLE = defineAction<
  { userId: string; title?: string | null },
  { title: string | null },
  PeopleError,
  { from: string | null; to: string | null }
>({
  id: "people.set_title",
  toolName: "set_person_title",
  description:
    "Set or clear one person's title (Supermaker, Tech Lead…); blank clears it. Proposes the change; nothing changes until the person confirms it on the card.",
  permission: "users.manage",
  risk: "people",
  maxBatch: 20,
  input: z.object({ userId: z.string(), title: z.string().nullable().optional() }),
  invalidInput: "invalid_title",
  subject: (input) => ({ type: "user", id: input.userId }),
  afterGate: reconcileFloorAfterGate,
  check: async (input) => {
    if (!normalizeTitle(input.title).ok) return "invalid_title";
    return (await findUserById(input.userId)) ? null : "unknown_user";
  },
  run: async (input) => {
    const normalized = normalizeTitle(input.title);
    if (!normalized.ok) return { ok: false, error: "invalid_title" };
    const { title } = normalized;

    const target = await findUserById(input.userId);
    if (!target) return { ok: false, error: "unknown_user" };
    if (target.title === title) return { ok: true, value: { title } };
    // Removed between the read above and this write: the same answer as never having existed.
    if (!(await updateUserTitle(target.id, title))) return { ok: false, error: "unknown_user" };
    return { ok: true, value: { title }, committed: { from: target.title, to: title } };
  },
  afterCommit: async (input, detail, ctx) => {
    const recorded = await record(
      {
        actorUserId: ctx.identity.userId,
        action: "user.title_changed",
        subjectType: "user",
        subjectId: input.userId,
        detail,
      },
      AUDIT_SURFACE
    );
    return recorded ? undefined : "audit_unavailable";
  },
  revalidate: [ADMIN_USERS_PATH],
});

// ── people.set_name ─────────────────────────────────────────────────

/**
 * Change anybody's display name. The write and its `user.name_changed` event
 * are `renamePerson`, shared with `/account`; so the audit gap, if any, is
 * known only to `run()`. No mirror push: the mirror carries name snapshots
 * written with each ticket and project, not the live `user.name`.
 */
export const PEOPLE_SET_NAME = defineAction<{ userId: unknown; name: unknown }, { name: string }, PeopleError>({
  id: "people.set_name",
  toolName: "set_person_name",
  description:
    "Change one person's display name. Proposes the change; nothing changes until the person confirms it on the card.",
  permission: "users.manage",
  risk: "people",
  // Lenient on purpose: the page answered `invalid_name` for a name that is not
  // text and `unknown_user` for an id that is not one, and still does.
  input: z.object({ userId: z.unknown(), name: z.unknown() }),
  invalidInput: "invalid_name",
  subject: (input) => ({ type: "user", id: typeof input.userId === "string" ? input.userId : "" }),
  afterGate: reconcileFloorAfterGate,
  check: async (input) => {
    if (!normalizeName(input.name).ok) return "invalid_name";
    const id = typeof input.userId === "string" ? input.userId : "";
    return (await findUserById(id)) ? null : "unknown_user";
  },
  run: async (input, ctx) => {
    const result = await renamePerson({
      actorUserId: ctx.identity.userId,
      targetUserId: typeof input.userId === "string" ? input.userId : "",
      name: input.name,
      surface: AUDIT_SURFACE,
    });
    if (!result.ok) return result;
    return {
      ok: true,
      value: { name: result.name },
      ...(result.changed ? { committed: true as const } : {}),
      ...(result.audited ? {} : { warning: "audit_unavailable" as const }),
    };
  },
  revalidate: [ADMIN_USERS_PATH],
});

// ── Shared ──────────────────────────────────────────────────────────

/**
 * Why `target` may not be moved to `nextRole`, or null when they may. Only
 * demotions are protected: the floor (a row that would disagree with the
 * running app) and the last super admin (a deployment with no floor can lock
 * itself out — spec §10).
 */
async function demotionProtection(target: UserRecord, nextRole: string): Promise<PeopleError | null> {
  if (nextRole === "super_admin") return null;
  if (isSuperAdminFloor(target.email)) return "protected_floor";
  if (target.role === "super_admin") {
    const remaining = await countUsersWithRole("super_admin", { excludeUserId: target.id });
    if (remaining === 0) return "last_super_admin";
  }
  return null;
}

/**
 * The incoming request's cookie as a real `Headers`: Better Auth iterates what
 * it is given and `next/headers` returns a read-only look-alike. `set-role`
 * is `requireHeaders: true` and authenticates from the session, which is why
 * every surface that confirms a role change must carry the person's cookie.
 */
async function requestHeaders(): Promise<Headers> {
  const incoming = await headers();
  const copy = new Headers();
  const cookie = incoming.get("cookie");
  if (cookie) copy.set("cookie", cookie);
  return copy;
}
