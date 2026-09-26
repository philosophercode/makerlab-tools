/**
 * The description rules (gateway spec amendment 2026-09-26 "Short
 * descriptions"). The owner's words: "say what the device is and what it does,
 * lightly touch on specs; one to three sentences, a complicated device max
 * five sentences."
 *
 * - {@link DESCRIPTION_RULES} is the shape as a model is told it — **one text**,
 *   shared by research's read prompt and `scripts/shorten-descriptions.ts`, so
 *   the two cannot drift. Each caller adds its own source rule (the pages, or
 *   only the current description).
 * - {@link descriptionProblems} is the same rule in code: what the shortening
 *   script selects on and checks a rewrite against.
 *
 * Pure, no imports: `scripts/` and workflow steps import it under plain Node.
 */

/** At most this many sentences, and only for a complicated machine; 1–3 is the norm. */
export const DESCRIPTION_MAX_SENTENCES = 5;

/** What a model is asked for: about this many characters or fewer. */
export const DESCRIPTION_TARGET_CHARS = 450;

/** "Roughly 450": over this, code treats a description as too long. */
export const DESCRIPTION_LIMIT_CHARS = 500;

export type DescriptionProblem = "too_many_sentences" | "too_long" | "has_list";

export const DESCRIPTION_RULES = [
  `The **description** is short plain prose a student reads on the tool's page: **one to three sentences**, at most ${DESCRIPTION_MAX_SENTENCES} for a complicated machine, about ${DESCRIPTION_TARGET_CHARS} characters or fewer.`,
  `- **Open with what the tool is** — its type, make and model — then say **what students use it for in a makerspace**, e.g. "In a makerspace, students use it to cut and engrave plywood and acrylic for enclosures, signs and prototypes."`,
  `- **Touch on specs lightly**: at most one or two headline specs (a working area, a laser power, a number of toolheads) woven into a sentence. **Never a list of specs**, never a Markdown list or table, no headings — the specs have their own place.`,
  `- Plain text, no marketing language. **Never mention protective equipment** (safety glasses, gloves, masks, hearing protection or any other PPE): the lab's staff set PPE.`,
  `- State each fact directly, for students — never "the product page says", "according to the manufacturer", or anything about how the description was written.`,
].join("\n");

/** Abbreviations whose full stop does not end a sentence (lower case, without the stop). */
const ABBREVIATIONS = new Set(["e.g", "i.e", "vs", "approx", "incl", "inc", "ltd", "corp", "no", "nos", "mr", "mrs", "ms", "dr", "fig", "ca", "u.s"]);

/** A Markdown bullet (`-`, `*`, `+`) or numbered (`1.`, `1)`) list line. */
const LIST_LINE = /^\s{0,3}(?:[-*+]|\d{1,3}[.)])\s+\S/m;

/**
 * How many sentences `text` has: a sentence ends at `.`, `!` or `?` followed
 * by whitespace or the end, except after a known abbreviation ("e.g.") or an
 * initial ("J."); a decimal ("0.4 mm") never ends one. Trailing text without a
 * stop counts as a sentence.
 */
export function countSentences(text: string): number {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return 0;
  let count = 0;
  let start = 0;
  const end = /[.!?]+["'”’)\]]*(?=\s|$)/g;
  for (let match = end.exec(flat); match; match = end.exec(flat)) {
    const stop = match.index + match[0].length;
    if (match[0].startsWith(".")) {
      const word = /(\S+)$/.exec(flat.slice(start, match.index))?.[1] ?? "";
      const bare = word.replace(/^["'“‘(\[]+/, "").toLowerCase();
      if (ABBREVIATIONS.has(bare) || /^[a-z]$/i.test(bare)) continue;
    }
    if (flat.slice(start, stop).trim()) count += 1;
    start = stop;
  }
  if (flat.slice(start).trim()) count += 1;
  return count;
}

/** Whether `text` has a Markdown bullet or numbered list line. */
export function hasMarkdownList(text: string): boolean {
  return LIST_LINE.test(text);
}

/** What breaks the description rules in `text`; empty when it follows them (or is empty). */
export function descriptionProblems(text: string | null | undefined): DescriptionProblem[] {
  const value = (text ?? "").trim();
  if (!value) return [];
  const problems: DescriptionProblem[] = [];
  if (countSentences(value) > DESCRIPTION_MAX_SENTENCES) problems.push("too_many_sentences");
  if (value.length > DESCRIPTION_LIMIT_CHARS) problems.push("too_long");
  if (hasMarkdownList(value)) problems.push("has_list");
  return problems;
}

/**
 * The numbers in `rewrite` that `original` does not contain — the cheap guard
 * against a rewrite that invented a spec. Thousands separators are ignored
 * ("1,500" is "1500"); a number counts as present when it appears anywhere in
 * the original as the same digits.
 */
export function newNumbers(original: string, rewrite: string): string[] {
  const numbers = (text: string) =>
    (text.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,(?=\d{3}\b)/g, ""));
  const known = new Set(numbers(original));
  return [...new Set(numbers(rewrite))].filter((n) => !known.has(n));
}
