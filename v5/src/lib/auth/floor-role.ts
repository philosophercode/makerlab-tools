import "server-only";

import { eq } from "drizzle-orm";

import { recordAuditEvent } from "../data/audit";
import { findUserById } from "../data/users";
import { getDb } from "../db/client";
import { user } from "../db/schema/index";
import type { Identity } from "./identity";
import { isSuperAdminFloor } from "./super-admins";

/**
 * Writing the super-admin floor onto the row it protects.
 *
 * **The floor was only half a floor.** `identityFromSession` resolves a listed
 * address as `super_admin` whatever its row says, which is what makes
 * `canReachAdmin` and `can(identity, "users.manage")` pass and `/admin/users`
 * render with live controls. But the writes that page performs go through the
 * Better Auth admin plugin, and the plugin authorizes against
 * `session.user.role` — the **stored** value, which it reads for itself and
 * which no override reaches. A floor address whose row still says `user`
 * therefore saw every control enabled and every save fail with an opaque
 * `failed`: precisely the lock-out the floor exists to undo.
 *
 * That is not a hypothetical. It is the ordinary shape of both cases the floor
 * was written for:
 *
 * - **A floor set after the fact.** Add (or correct) an address in
 *   `AUTH_SUPER_ADMIN_EMAILS` for somebody who has already signed in once, and
 *   `databaseHooks.user.create.before` — the only other place the floor is
 *   applied — never runs for them. Their row holds the `defaultRole` `user`.
 * - **Recovery.** A `super_admin` demoted by a restored backup or a manual SQL
 *   edit is exactly who the floor is meant to let back in.
 *
 * **So the row is reconciled rather than the check relaxed.** The alternative —
 * teaching the plugin about the floor — is not available: `hasPermission` takes
 * the role off the session and there is no hook in front of it. Writing the
 * stored role to match what the app already reports is also the more honest
 * end state: after this runs, `/admin/users` shows the same role the person
 * actually has, and a reader of the table is not left comparing it against an
 * environment variable.
 *
 * It is **only ever a promotion to `super_admin`, and only for an address the
 * environment already names.** The authority is `AUTH_SUPER_ADMIN_EMAILS`,
 * which is deployment configuration and not user input, and the effect is one
 * the app's own identity layer had already granted. Nothing here can lower a
 * role or raise one the floor does not list.
 */

/**
 * Make `identity`'s stored role match the floor, if the floor covers them.
 *
 * Returns true when a row was changed. A no-op — and one cheap query — for
 * everybody else, which is every caller in a deployment with no floor set.
 *
 * Throws on a database failure. The caller is about to perform a write that
 * depends on this having happened, so a silent failure here would surface as
 * the same unexplained `failed` this function exists to remove.
 */
export async function reconcileSuperAdminFloor(identity: Identity): Promise<boolean> {
  if (!identity.userId) return false;
  if (!isSuperAdminFloor(identity.email)) return false;

  const stored = await findUserById(identity.userId);
  // No row (deleted mid-request) or already correct: nothing to write. The
  // common case by far, once the first reconciliation has happened.
  if (!stored || stored.role === "super_admin") return false;

  const db = await getDb();
  await db
    .update(user)
    .set({ role: "super_admin", updatedAt: new Date() })
    .where(eq(user.id, identity.userId));

  // Recorded like any other role change, because it is one — and because a
  // role that appeared without anybody clicking anything is exactly the entry
  // somebody reading the trail later will want an explanation for. The actor
  // is null: the environment did this, not a person.
  await recordAuditEvent({
    actorUserId: null,
    action: "role.changed",
    subjectType: "user",
    subjectId: identity.userId,
    detail: {
      from: stored.role,
      to: "super_admin",
      reason: "super_admin_floor",
    },
  });

  return true;
}
