/**
 * A person's display name — what the roster, the profile menu and every
 * "reported by" line call them.
 *
 * Three places write it: Google at sign-up, a super admin on the People page
 * (`setUserName`), and the person themselves on `/account` (`updateOwnName`).
 * Both hand-written paths normalise with {@link normalizeName}, so "what is a
 * valid name" is decided once.
 *
 * **A placeholder is not a name.** Add person stores the address as the name
 * when nobody typed one (`app/admin/users/actions.ts`), and that is the only
 * name Google's may replace later (`lib/auth/provider-name.ts`). Everything
 * else somebody chose — a name typed at Add person, or edited since — stays.
 *
 * Pure and universal: the server actions validate with it and the editors
 * show its limit.
 */

/** The longest name kept, once trimmed. */
export const PERSON_NAME_MAX_LENGTH = 80;

/**
 * A name as typed, made storable: trimmed, inner runs of whitespace (a pasted
 * newline, a tab) collapsed to one space. Refused — never cut — when it is not
 * a string, is blank, or is longer than {@link PERSON_NAME_MAX_LENGTH}: a
 * silently truncated name is one nobody chose, and nobody may have no name.
 */
export function normalizeName(raw: unknown): { ok: true; name: string } | { ok: false } {
  if (typeof raw !== "string") return { ok: false };
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name || name.length > PERSON_NAME_MAX_LENGTH) return { ok: false };
  return { ok: true, name };
}

/**
 * True when `person.name` is a stand-in rather than a name somebody chose:
 * blank, or the address itself (what Add person stores when no name was
 * typed). Case-insensitive, because the address is stored lower-cased and a
 * Google profile may not be.
 */
export function isPlaceholderName(person: { name: string | null | undefined; email: string }): boolean {
  const name = (person.name ?? "").trim().toLowerCase();
  return !name || name === person.email.trim().toLowerCase();
}
