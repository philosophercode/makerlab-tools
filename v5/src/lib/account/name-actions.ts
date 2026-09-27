import "server-only";

import { revalidatePath } from "next/cache";
import { renamePerson } from "../people/rename";
import { authorizeAccountAction, type AccountActionWarning } from "./token-actions";

/**
 * **Name** on `/account`: somebody changes their own display name.
 *
 * The gate is the account one (`authorizeAccountAction`: identity, the
 * `account` limiter, signed in), and the target is **always the caller** —
 * there is no id in the input to point at anybody else. Renaming somebody
 * else is `setUserName` on the People page, behind `users.manage`. The rule
 * for a name, the write and the `user.name_changed` event are
 * `renamePerson`, shared by both.
 *
 * A name set here is never overwritten by Google at a later sign-in
 * (`lib/auth/provider-name.ts`).
 */

export type OwnNameError = "not_signed_in" | "rate_limited" | "invalid_name" | "unknown_user" | "failed";

export type UpdateOwnNameResult =
  | { ok: true; name: string; warning?: AccountActionWarning }
  | { ok: false; error: OwnNameError };

/** Where the name is edited, and the path a change invalidates. */
export const ACCOUNT_PATH = "/account";

export async function updateOwnName(input: { name: string }): Promise<UpdateOwnNameResult> {
  const gate = await authorizeAccountAction();
  if (!gate.ok) {
    return { ok: false, error: gate.error === "rate_limited" || gate.error === "not_signed_in" ? gate.error : "failed" };
  }
  const { userId } = gate.identity;

  const result = await renamePerson({
    actorUserId: userId,
    targetUserId: userId,
    name: input?.name,
    surface: "account",
  });
  if (!result.ok) return result;

  if (result.changed) revalidatePath(ACCOUNT_PATH);
  return { ok: true, name: result.name, ...(result.audited ? {} : { warning: "audit_unavailable" as const }) };
}
