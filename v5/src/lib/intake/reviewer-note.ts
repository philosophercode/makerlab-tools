import { REVIEWER_NOTE_MAX_CHARS } from "./limits.ts";

/**
 * A reviewer's instruction to research — the optional note on **Research
 * again** and on **Find a different image** (amendment "Product-page first,
 * front-facing images, reviewer notes"; one paragraph of up to
 * `REVIEWER_NOTE_MAX_CHARS` since the amendment "Guided redo").
 *
 * It is typed by a person holding `tools.approve`, so it is trusted to say
 * *where to look* ("use the bambulab.com X2D product page") — but it still
 * reaches a model prompt, so it gets the treatment every typed field gets:
 * **one paragraph, capped, and nothing that could close its fence**. Angle
 * brackets and backticks are dropped (the prompt fences it in a tag), control
 * characters too, and line breaks and other whitespace collapse to single
 * spaces — a note typed over several lines arrives as one paragraph.
 *
 * Client-safe and plain Node: the route, the server action, the prompt and the
 * textarea all use the same rule.
 */

/** The note as one clean paragraph on one line (possibly empty). Does not cap: {@link parseReviewerNote} decides what is too long. */
export function cleanReviewerNote(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f<>`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The note to store and send, from whatever the request carried: null for
 * none (absent, null, or blank once cleaned), the cleaned line when it fits in
 * {@link REVIEWER_NOTE_MAX_CHARS}, and `"too_long"` when it does not — a
 * refusal, never a silent cut of an instruction somebody wrote.
 */
export function parseReviewerNote(raw: unknown): string | null | "too_long" | "invalid" {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") return "invalid";
  const line = cleanReviewerNote(raw);
  if (!line) return null;
  return line.length > REVIEWER_NOTE_MAX_CHARS ? "too_long" : line;
}

/** For a prompt: cleaned again and clipped, whatever the caller did first. */
export function reviewerNoteForPrompt(note: string | null | undefined): string | null {
  const line = cleanReviewerNote(note ?? "");
  if (!line) return null;
  return line.length > REVIEWER_NOTE_MAX_CHARS ? `${line.slice(0, REVIEWER_NOTE_MAX_CHARS - 1)}…` : line;
}
