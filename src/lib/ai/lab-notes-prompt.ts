import { labNoteLines } from "../lab-notes/lines";

/**
 * What the chat prompt says about lab notes (identity spec amendment "Lab
 * notes", 2026-10-06): the lab staff's own rules and tips, which the
 * assistant gives first, prefers over a manual and cites as a lab note.
 *
 * Two parts:
 *
 * - {@link labNotesSection} — the rules, then the lab-wide notes. Placed in
 *   the prompt's stable prefix right after "Where you are": it is the same
 *   for every request until staff change the notes, so it stays cacheable.
 * - {@link toolLabNotesLines} — one tool's notes, for the focused tool's
 *   description in the per-request tail. Other tools' notes reach the model
 *   through `get_tool_details` (`lab_notes`), and the catalog list marks each
 *   tool that has some ({@link LAB_NOTES_MARK}).
 *
 * The example in the rules is a placeholder on purpose. A real-sounding rule
 * there ("put a cutting mat underneath") is one the model could repeat as a
 * lab note for a tool that has none.
 */

/** How the catalog list marks a tool that has lab notes. */
export const LAB_NOTES_MARK = "lab notes";

/** How the assistant cites a lab note. */
export const LAB_NOTE_CITATION = "**Lab note:**";

const RULES = `## Lab notes

Lab notes are the lab staff's own rules and tips for this lab: local knowledge no manual has. There are two kinds. **Lab-wide notes** apply to the whole lab; they are listed at the end of this section when there are any. **A tool's lab notes** apply to that tool: \`get_tool_details\` returns them as \`lab_notes\`, Active tool context lists them for the tool on screen, and the catalog list marks each tool that has some with "${LAB_NOTES_MARK}".

- **Read them first.** Before you explain how to use, set up, clean up or troubleshoot a tool the catalog marks "${LAB_NOTES_MARK}", call \`get_tool_details\` for it, unless it is the tool in Active tool context.
- **Give them first.** Put the lab notes that apply before generic or manual guidance.
- **They win.** When a lab note and a manual, the manufacturer or general knowledge differ, follow the lab note and say it is how this lab does it. Keep a manual's safety warning as well.
- **Cite each one as a lab note.** Begin the sentence with ${LAB_NOTE_CITATION} in bold: "${LAB_NOTE_CITATION} <what the note says>". A lab note has no link and no page number. Never attribute a lab note to a manual or a web page, and never present a manual's text as a lab note.
- **Never invent one.** When a tool has no lab notes, do not say the lab has a rule about it. For a lab rule that is not written here, send the person to the lab's staff.`;

/**
 * The rules, then the lab-wide notes as bullets when there are any. Each note
 * is already one flattened line (`labNoteLines`), so none can start a heading
 * of its own in the prompt.
 */
export function labNotesSection(labWide: readonly string[]): string {
  if (labWide.length === 0) return RULES;
  return `${RULES}\n\n### Lab-wide notes\n\n${labWide.map((line) => `- ${line}`).join("\n")}`;
}

/**
 * One tool's lab notes as lines of its prompt description, indented under a
 * header line; empty when it has none.
 */
export function toolLabNotesLines(notes: string | null | undefined): string[] {
  const lines = labNoteLines(notes);
  if (lines.length === 0) return [];
  return [`- Lab notes (from the lab's staff; give these first and cite each as ${LAB_NOTE_CITATION}):`, ...lines.map((line) => `  - ${line}`)];
}
