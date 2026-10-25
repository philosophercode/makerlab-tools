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
 * The patterns run on the first {@link SCRUB_INPUT_CHARS} code points only:
 * the email pattern backtracks quadratically on a long run with no `@`, and a
 * chat message may be 400,000 characters (security audit 2026-10-23). Then
 * whitespace is folded and the text is capped at {@link SCRUB_MAX_CHARS}
 * characters (by code point, so a cap never splits an emoji or a CJK
 * character). Pure; a name the patterns miss is why the text is admin-only,
 * short-lived and never backed up.
 */

export const SCRUB_MAX_CHARS = 300;
export const REDACTED = "[…]";
/** How much of the question the patterns see; a few times the stored cap. */
export const SCRUB_INPUT_CHARS = SCRUB_MAX_CHARS * 4;

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
const URL_LIKE = /\b(?:https?:\/\/|www\.)[^\s<>"']+/giu;
// A phone number: optional +country, then digit groups joined by space, dot,
// dash or parentheses, with at least seven digits in all.
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{2,4}(?:[\s.-]\d{2,4}){1,3}|\b\d{7,15}\b/g;
const NETID = /\b[a-z]{2,3}\d{2,5}\b/giu;

function digitCount(text: string): number {
  return (text.match(/\d/g) ?? []).length;
}

/**
 * The first {@link SCRUB_INPUT_CHARS} code points, whitespace folded first (a
 * linear pass) so padding cannot push an address past the cut. When the text
 * is cut, the last, possibly partial token is dropped too: half an address is
 * not one the email pattern can see.
 */
function boundedInput(text: string): string {
  const folded = text.replace(/\s+/g, " ");
  const chars = Array.from(folded);
  if (chars.length <= SCRUB_INPUT_CHARS) return folded;
  const cut = chars.slice(0, SCRUB_INPUT_CHARS).join("");
  const lastSpace = cut.lastIndexOf(" ");
  return lastSpace > 0 ? cut.slice(0, lastSpace) : "";
}

export function scrubQuestion(text: string): string {
  let out = boundedInput(String(text ?? ""));
  out = out.replace(EMAIL, REDACTED);
  out = out.replace(URL_LIKE, REDACTED);
  out = out.replace(PHONE, (match) => (digitCount(match) >= 7 ? REDACTED : match));
  out = out.replace(NETID, REDACTED);
  out = out.replace(/\s+/g, " ").trim();
  const chars = Array.from(out);
  return chars.length > SCRUB_MAX_CHARS ? `${chars.slice(0, SCRUB_MAX_CHARS - 1).join("").trimEnd()}…` : out;
}
