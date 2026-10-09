/**
 * Lab notes (identity spec amendment "Lab notes", 2026-10-06): the lab's own
 * rules and tips, written by staff, that no manual has. "Box cutter: always
 * put a cutting mat underneath so you don't scratch the table."
 *
 * Two kinds, one shape. A tool's lab notes are its `tools.notes` column, set
 * in the tool editor. The lab-wide notes are one `lab_settings` row
 * (`lab_notes`), set on `/admin/inventory/lab-notes`. Both are plain text,
 * **one note per line**, and both are read through {@link labNoteLines}: the
 * tool page lists the lines, and the assistant's prompt gets the same lines as
 * bullets. Plain text rather than Markdown on purpose: a note is a sentence,
 * and a line break staff typed should stay a line break on the page.
 *
 * Pure and dependency-free, relative imports only: client components, the
 * chat prompt and `scripts/` under plain Node all import it.
 */

/** The most lines one set of notes contributes. The rest are not shown and not sent. */
export const LAB_NOTES_MAX_LINES = 30;

/** The longest one note may be once read. A longer line is cut, with an ellipsis. */
export const LAB_NOTE_LINE_MAX_CHARS = 500;

/**
 * "- ", "* ", "• ", "– " or "1. " at the start of a line, or a marker alone
 * on its line: list formatting staff typed, not part of the note.
 */
const LIST_MARKER = /^(?:[-*•–]|\d{1,2}[.)])(?:\s+|$)/;

/**
 * The notes as lines: one per non-blank line, each flattened to one line of
 * text (tabs and runs of spaces collapsed), a typed list marker dropped, cut
 * at {@link LAB_NOTE_LINE_MAX_CHARS}, at most {@link LAB_NOTES_MAX_LINES} of
 * them. Null, undefined and blank text are no notes.
 *
 * Flattening is also what keeps a note from reshaping the assistant's prompt:
 * a line can never start a heading or a fence there, because every line is
 * sent as a bullet of its own.
 */
export function labNoteLines(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/\s+/g, " ").trim().replace(LIST_MARKER, "").trim();
    if (!line) continue;
    out.push(line.length > LAB_NOTE_LINE_MAX_CHARS ? `${line.slice(0, LAB_NOTE_LINE_MAX_CHARS - 1)}…` : line);
    if (out.length === LAB_NOTES_MAX_LINES) break;
  }
  return out;
}

/** True when `text` holds at least one note. */
export function hasLabNotes(text: string | null | undefined): boolean {
  return labNoteLines(text).length > 0;
}
