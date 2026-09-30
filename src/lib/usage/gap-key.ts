/**
 * The Unanswered queue's grouping key (usage insight spec §4): one row per
 * question *and* tool, however it was typed.
 *
 * The (already scrubbed) question is folded — lower case, accents off,
 * punctuation and runs of whitespace to one space — so "How do I cut glass?"
 * and "how do i cut  glass" are one gap. The tool id stays in the key, so the
 * same words asked on two machines' pages are two gaps: they are two different
 * things for staff to fix. Pure.
 */
export function normaliseQuestion(question: string): string {
  return question
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function gapKey(question: string, toolId: string | null | undefined): string {
  return `${toolId ?? "-"}|${normaliseQuestion(question)}`;
}
