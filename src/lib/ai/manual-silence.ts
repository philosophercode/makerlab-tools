/**
 * "When the documents are silent": the one rule for a machine question that
 * the machine's own documents do not answer (manual text spec amendment
 * 2026-10-06 "An answer cites only its machine's documents").
 *
 * Before this, four places said four things (citation audit 2026-10-06, F3):
 * `search_manual`'s `no_results` message said never answer from memory, the
 * manuals prompt allowed labelled general guidance, the intro said "grounded
 * only in the catalog", and the lab context said "say you don't know". The
 * model picked one per run. Now the rule is written once, here, and each of
 * those places refers to it by its heading ({@link MANUAL_SILENCE_HEADING}).
 *
 * It agrees with the blocks around it: the lab's own knowledge still comes
 * first ("The lab first, then its people", `lab-companion.ts`), a lab rule
 * nobody wrote is still sent to staff ("Lab notes", `lab-notes-prompt.ts`),
 * and a lab note or SOP that covers the question means the documents are not
 * silent. Static text, in the prompt's cacheable prefix.
 */

/** The heading other prompt blocks name to point here. */
export const MANUAL_SILENCE_HEADING = "When the documents are silent";

export const MANUAL_SILENCE = `## ${MANUAL_SILENCE_HEADING}

The one rule for a question about a machine that its own documents do not answer: no passage came back, or the passages do not cover the question. A lab note or the lab's SOP that covers it counts as an answer.

- **Say so plainly, for that machine.** "The X1-Carbon's documents in the lab don't cover this", or that no searchable document is on file for it.
- **Never use another machine's document instead**, not even a similar machine's. A passage is evidence only for the machine it belongs to.
- **General guidance only if it is safe**, and only under its own line that starts "General guidance, not from the <machine>'s documents:". Never give settings, temperatures, power, speeds or other figures as general guidance.
- **Safety goes to people.** For anything about safety, a first use, or a step that could hurt someone or damage the machine, send the student to MakerLAB staff or a SuperMaker instead of guessing.`;
