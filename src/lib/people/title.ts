import { USER_TITLE_MAX_LENGTH, type Role } from "../db/schema/vocabulary";

/**
 * A person's title — the label under their name on the People page and in the
 * profile menu.
 *
 * **Stored only when it is custom.** `user.title` is null for almost everyone;
 * what they are shown is derived from the role (`admin.titles.<role>` in
 * `messages/en.json`), so a role change moves the default with it and nobody
 * has to remember to rewrite a label. A super admin can set a custom one, and
 * clearing it goes back to the default.
 *
 * Pure and universal: the People page's server action normalises with it and
 * the client components display with it, so the two cannot disagree about
 * what "blank" means.
 */

export { USER_TITLE_MAX_LENGTH };

/** The fields the rule reads. A roster row and a client identity both fit. */
export interface Titled {
  role: Role;
  title?: string | null;
}

/**
 * What `person` is shown as: their custom title when they have one, otherwise
 * `roleDefault(role)` — the caller's translated label, so this module holds no
 * English.
 */
export function displayTitle(person: Titled, roleDefault: (role: Role) => string): string {
  const custom = person.title?.trim();
  return custom ? custom : roleDefault(person.role);
}

/**
 * A title as typed, made storable: trimmed, inner runs of whitespace (a pasted
 * newline, a tab) collapsed to one space. Blank — or null — is `null`, "no
 * custom title". Anything that is not a string, or longer than
 * {@link USER_TITLE_MAX_LENGTH} once trimmed, is refused rather than cut: a
 * silently truncated title is a label nobody chose.
 */
export function normalizeTitle(
  raw: unknown
): { ok: true; title: string | null } | { ok: false } {
  if (raw === null || raw === undefined) return { ok: true, title: null };
  if (typeof raw !== "string") return { ok: false };
  const title = raw.replace(/\s+/g, " ").trim();
  if (!title) return { ok: true, title: null };
  if (title.length > USER_TITLE_MAX_LENGTH) return { ok: false };
  return { ok: true, title };
}
