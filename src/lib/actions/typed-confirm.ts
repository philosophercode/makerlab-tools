/**
 * The destructive card's typed confirmation (assistant–GUI parity spec §5.4,
 * §10 "the destructive typed-name match (trim, case, Unicode normalization)").
 *
 * Client-safe, so the card can enable Confirm on exactly the rule the confirm
 * route enforces again (`decideActionProposals`): the typed text equals the
 * subject's stored name once both are Unicode-normalised (NFKC), trimmed,
 * runs of whitespace collapsed and case-folded. An empty name never matches.
 */
export function typedMatches(typed: string | undefined, subjectName: string): boolean {
  const fold = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
  return typeof typed === "string" && fold(subjectName).length > 0 && fold(typed) === fold(subjectName);
}
