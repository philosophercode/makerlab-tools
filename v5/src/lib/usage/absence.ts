/**
 * Did the answer itself say "we don't have that" / "the manual doesn't cover
 * it"? (usage insight spec §5.2, the honest-absence answers.)
 *
 * The deterministic gap signals only see tool results. An answer like "The lab
 * doesn't have a waterjet cutter" often never touched a tool — the catalogue
 * is already in the prompt — so without this those questions are invisible.
 * Phase 3's `record_gap` tool is the precise version; until it is evaluated,
 * this is a short list of the phrases the prompt asks the assistant to use
 * when it cannot answer (English only; approximate by design, and the page
 * says the counts are).
 *
 * Deliberately narrow: each pattern names the catalogue, the lab, a manual or
 * "information", so an answer that merely says "you don't have to wear
 * gloves" is not a gap. Pure.
 */

const ABSENCE = [
  /\b(?:is not|isn't|are not|aren't|not) (?:in|part of|listed in) (?:the|our) (?:lab'?s? )?(?:catalog|catalogue|inventory)\b/,
  /\b(?:the|our) (?:lab|makerlab|catalog|catalogue|inventory) (?:does not|doesn't|do not|don't) (?:have|include|list|carry|stock)\b/,
  /\b(?:does not|doesn't) (?:appear|seem) to (?:be )?(?:in|have)\b.*\b(?:catalog|catalogue|inventory|lab)\b/,
  /\bno (?:such )?(?:tool|machine|equipment) (?:in|like that in) (?:the|our) (?:lab|catalog|catalogue|inventory)\b/,
  /\b(?:the |this |its )?manuals? (?:does not|doesn't|do not|don't) (?:cover|mention|say|include|describe)\b/,
  /\bnot (?:covered|mentioned|described) in (?:the|its|this) manuals?\b/,
  /\b(?:i )?(?:could not|couldn't|cannot|can't) find (?:any )?(?:information|details|anything|a (?:tool|machine))\b/,
  /\bi (?:do not|don't) have (?:any )?(?:information|details)\b/,
];

export function answerDeclaresAbsence(text: string | null | undefined): boolean {
  const answer = String(text ?? "").toLowerCase().replace(/[’‘]/g, "'");
  if (!answer.trim()) return false;
  return ABSENCE.some((re) => re.test(answer));
}
