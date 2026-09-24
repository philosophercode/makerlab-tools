/**
 * Text and label normalization shared by the diff (`propose.ts`), the lab-rule
 * guard (`lab-rules.ts`) and the decision helpers (`decide.ts`).
 *
 * Pure. Plain Node: the refresh workflow's step imports it.
 */

/** Case, punctuation and whitespace flattened — for names and sentences. */
export function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** A label as a set member: "PLA+" and "pla" are two labels, "Wood." and "wood" one. */
export function normalizeLabel(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s._\-/]+/g, " ").trim();
}
