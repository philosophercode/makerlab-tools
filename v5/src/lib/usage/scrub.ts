/**
 * Scrub a student's question before it is stored (usage insight spec §4, §8).
 *
 * The one piece of student text Usage Insight keeps is the wording of an
 * unanswered question, and only so staff can act on it. Before it is stored,
 * anything shaped like a way to reach or identify a person is replaced with
 * `[…]`:
 *
 * - email addresses;
 * - URLs (with their query strings, which carry tokens and ids);
 * - phone numbers (`+1 (607) 555-0123`, `607.555.0123`, 7+ digits in a run);
 * - NetID-shaped tokens (2–3 letters then 2–5 digits: `abc123`, `jd42`). One
 *   digit is spared on purpose: `CO2` and `MK4` are what students ask about.
 *
 * Then whitespace is folded and the text is capped at {@link SCRUB_MAX_CHARS}
 * characters (by code point, so a cap never splits an emoji or a CJK
 * character). Pure; a name the patterns miss is why the text is admin-only,
 * short-lived and never backed up.
 */

export const SCRUB_MAX_CHARS = 300;
export const REDACTED = "[…]";

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
const URL_LIKE = /\b(?:https?:\/\/|www\.)[^\s<>"']+/giu;
// A phone number: optional +country, then digit groups joined by space, dot,
// dash or parentheses, with at least seven digits in all.
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{2,4}(?:[\s.-]\d{2,4}){1,3}|\b\d{7,15}\b/g;
const NETID = /\b[a-z]{2,3}\d{2,5}\b/giu;

function digitCount(text: string): number {
  return (text.match(/\d/g) ?? []).length;
}

export function scrubQuestion(text: string): string {
  let out = String(text ?? "");
  out = out.replace(EMAIL, REDACTED);
  out = out.replace(URL_LIKE, REDACTED);
  out = out.replace(PHONE, (match) => (digitCount(match) >= 7 ? REDACTED : match));
  out = out.replace(NETID, REDACTED);
  out = out.replace(/\s+/g, " ").trim();
  const chars = Array.from(out);
  return chars.length > SCRUB_MAX_CHARS ? `${chars.slice(0, SCRUB_MAX_CHARS - 1).join("").trimEnd()}…` : out;
}
