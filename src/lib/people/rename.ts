import { record } from "../admin/audit-warning";
import { findUserById, updateUserName } from "../data/users";
import { normalizeName } from "./name";

/**
 * Change one person's display name, and record it — the write behind both
 * **Edit name** on the People page (`setUserName`, a super admin renaming
 * anybody) and **Name** on `/account` (`updateOwnName`, somebody renaming
 * themselves).
 *
 * Deliberately **not** a gate. Who may rename whom is the caller's decision,
 * made before this runs: `users.manage` on the People page, "it is your own
 * row" on `/account`. This holds only what both share — the rule for a name
 * (`normalizeName`), the unknown target, the write, and the
 * `user.name_changed` event with `{ from, to }`.
 *
 * Saving the name the person already has is a no-op success with no audit
 * event, like a title or a role. A lost audit event is `audited: false` on a
 * success, never a failure (`lib/admin/audit-warning.ts`).
 *
 * A name edited here is never overwritten by Google: an account already
 * linked is not updated at sign-in, and the one link that can happen later
 * (somebody added before their first sign-in) keeps any name that is not the
 * address placeholder — `lib/auth/provider-name.ts`.
 */

export type RenameError = "invalid_name" | "unknown_user" | "failed";

export type RenameResult =
  | { ok: true; name: string; changed: boolean; audited: boolean }
  | { ok: false; error: RenameError };

export interface RenameInput {
  /** Who is making the change — the audit event's actor. */
  actorUserId: string | null;
  /** Whose name changes. The same id as the actor on `/account`. */
  targetUserId: string;
  /** As typed; normalised here. */
  name: unknown;
  /** Names the surface in the console line a missing audit event leaves. */
  surface: string;
}

export async function renamePerson(input: RenameInput): Promise<RenameResult> {
  const normalized = normalizeName(input.name);
  if (!normalized.ok) return { ok: false, error: "invalid_name" };
  const { name } = normalized;

  let target;
  try {
    target = await findUserById(input.targetUserId);
    if (!target) return { ok: false, error: "unknown_user" };
    if (target.name === name) return { ok: true, name, changed: false, audited: true };
    // Removed between the read and this write: the same answer as never having existed.
    if (!(await updateUserName(target.id, name))) return { ok: false, error: "unknown_user" };
  } catch (err) {
    console.error(`[${input.surface}] rename failed`, err);
    return { ok: false, error: "failed" };
  }

  const audited = await record(
    {
      actorUserId: input.actorUserId,
      action: "user.name_changed",
      subjectType: "user",
      subjectId: target.id,
      detail: { from: target.name, to: name },
    },
    input.surface
  );
  return { ok: true, name, changed: true, audited };
}
