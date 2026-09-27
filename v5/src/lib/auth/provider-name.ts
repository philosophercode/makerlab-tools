import { findUserByEmail } from "../data/users";
import { isPlaceholderName } from "../people/name";
import type { Db } from "../db/types";

/**
 * Whose name wins when somebody signs in with Google: the one already on
 * their row, unless that is only a placeholder.
 *
 * Better Auth writes a Google profile's name onto a `user` row in exactly two
 * cases in this configuration (`auth/config.ts`, Better Auth 1.6):
 *
 * 1. **Sign-up** — no row for the address yet. Google's name is all there is,
 *    and it is used.
 * 2. **Account linking** — a row exists with no Google account: somebody a
 *    super admin added on the People page, signing in for the first time.
 *    `updateUserInfoOnLink` copies the profile's name and photo onto the row.
 *
 * An account that is already linked is *not* updated at sign-in
 * (`overrideUserInfoOnSignIn` is left off), so a name somebody edited after
 * signing in is safe from Google already. Case 2 is the one that needs this:
 * a super admin who typed "Luis Example" at Add person — or corrected it on
 * the roster before Luis ever signed in — meant that name. So the Google
 * provider's `mapProfileToUser` asks this function first, and when the row's
 * name is a real one it is handed back *as* the profile's name: the link then
 * writes the same value and nothing changes. The photo still comes from
 * Google. When the row's name is the address placeholder (nobody typed one),
 * Google's name replaces it, as before.
 *
 * Never throws: a lookup that fails leaves Google's name in place rather than
 * failing somebody's sign-in over a display name.
 */
export async function keepChosenName(
  profile: { email?: unknown },
  db: Db
): Promise<{ name?: string }> {
  if (typeof profile.email !== "string" || !profile.email) return {};
  try {
    const existing = await findUserByEmail(profile.email, { db });
    if (!existing || isPlaceholderName(existing)) return {};
    return { name: existing.name };
  } catch (err) {
    console.error("[auth] could not read the stored name at sign-in", err);
    return {};
  }
}
