import { z } from "zod";

/**
 * The lab-wide notes as stored (identity spec amendment "Lab notes"): one
 * `lab_settings` row, key `lab_notes`, value `{ text }`. The text is what
 * staff typed on `/admin/inventory/lab-notes`, one note per line; the readers
 * split it with `labNoteLines` (`./lines.ts`).
 *
 * Kept short on purpose, like the "Where you are" block it sits beside: every
 * chat turn pays for it. {@link LAB_NOTES_MAX_CHARS} is about a thousand
 * tokens.
 *
 * Pure and directive-free: the page, the island, the action and the chat's
 * read all share it. The stored value is re-validated on every read and a
 * value that no longer parses reads as no notes, never as an error.
 */

/** The longest the lab-wide notes may be, in characters. */
export const LAB_NOTES_MAX_CHARS = 4000;

/** What the action takes and what the row holds. */
export const labNotesSchema = z.object({
  text: z.string().max(LAB_NOTES_MAX_CHARS, "too_long"),
});

export type LabNotes = z.infer<typeof labNotesSchema>;

/**
 * The text as it is stored: line endings made `\n`, trailing spaces dropped
 * from each line, runs of blank lines folded to one, and the whole trimmed.
 * Saving the same notes twice stores the same value, so the second save is a
 * no-op (`setLabSetting` answers `changed: false`).
 */
export function normalizeLabNotes(input: LabNotes): LabNotes {
  const text = input.text
    .replace(/\r\n|\r/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text };
}

/** The stored value's text, or "" when there is none or it no longer parses. */
export function readLabNotesSetting(value: unknown): string {
  const parsed = labNotesSchema.safeParse(value);
  return parsed.success ? parsed.data.text : "";
}
