import type { ManualOutlineEntry } from "../db/schema/manuals.ts";

/**
 * `manualDigest(manual, maxChars)` — what research's read model is given of a
 * manual (manual text spec §3.7): its **outline**, then the **pages richest in
 * spec-like lines**, each labelled with its page, within the manual text
 * budget (`RESEARCH_MANUAL_TEXT_MAX_CHARS`).
 *
 * A 200-page manual is far over any budget, and its first 16 000 characters
 * are the cover, the safety notices and the table of contents — the reason the
 * search's copy of a manual rarely carried a specification. The outline tells
 * the model what the manual covers; the pages chosen are the ones with the
 * most lines that look like a specification ("Work area: 400 x 300 mm",
 * "Input voltage 110-120 V") — a page a "Specifications" chapter opens on
 * counts extra — shown in page order.
 *
 * Pure. Plain Node: step code imports it.
 */

export interface DigestSource {
  outline: readonly ManualOutlineEntry[];
  pages: readonly { pageNumber: number; label: string | null; text: string }[];
}

/** The most of the budget the outline may take, so pages always have room. */
export const OUTLINE_SHARE = 0.25;

/** Outline entries deeper than this are left out of the digest. */
const OUTLINE_MAX_LEVEL = 2;

const UNIT =
  "(?:mm|cm|m|km|µm|um|nm|in|inch|inches|ft|\"|kg|g|mg|lb|lbs|oz|w|kw|mw|v|vac|vdc|a|ma|mah|wh|hz|khz|mhz|ghz|rpm|°c|°f|c|f|psi|bar|kpa|mpa|l|ml|dpi|ppi|db|db\\(a\\)|mm/s|m/s|mm/min|ipm|n|nm|n·m|w/mk|%)";
const NUMBER_WITH_UNIT = new RegExp(`\\d(?:[\\d.,]*)\\s?(?:-|–|to|~)?\\s?(?:[\\d.,]*)\\s?${UNIT}(?![a-z])`, "i");
const DIMENSIONS = /\d[\d.,]*\s?[x×]\s?\d[\d.,]*/i;
const LABEL_VALUE = /^[A-Za-z][^:]{1,40}:\s*\S*\d/;

/** True for a line that reads like a specification: a number with a unit, dimensions, or "Label: 12…". */
export function isSpecLine(line: string): boolean {
  const text = line.trim();
  if (text.length < 3 || text.length > 160) return false;
  return NUMBER_WITH_UNIT.test(text) || DIMENSIONS.test(text) || LABEL_VALUE.test(text);
}

/** How many spec-like lines a page has. */
export function specScore(text: string): number {
  return text.split("\n").filter(isSpecLine).length;
}

/** An outline title that names the specifications. */
const SPEC_SECTION = /spec|technical data|technische daten|dimensions|capacit/i;

/** How much a page in a specifications section counts for, on top of its own spec lines. */
export const SPEC_SECTION_BONUS = 5;

/** The page each specifications section opens on, and the page after it. */
export function specSectionPages(outline: readonly ManualOutlineEntry[]): Set<number> {
  const pages = new Set<number>();
  for (const entry of outline) {
    if (!SPEC_SECTION.test(entry.title)) continue;
    pages.add(entry.page);
    pages.add(entry.page + 1);
  }
  return pages;
}

/** The outline as an indented list with pages: "- Specifications (p. 12)". */
export function formatOutline(outline: readonly ManualOutlineEntry[], maxChars: number): string {
  const lines: string[] = [];
  let used = 0;
  for (const entry of outline) {
    if (entry.level > OUTLINE_MAX_LEVEL) continue;
    const line = `${"  ".repeat(Math.max(0, entry.level - 1))}- ${entry.title} (p. ${entry.page})`;
    if (used + line.length + 1 > maxChars) {
      lines.push("  …");
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}

function pageHeading(page: DigestSource["pages"][number]): string {
  return page.label ? `[page ${page.pageNumber} (printed ${page.label})]` : `[page ${page.pageNumber}]`;
}

/**
 * The digest: "Contents:" and the outline (at most {@link OUTLINE_SHARE} of the
 * budget), then the chosen pages in page order. Pages are chosen by spec score,
 * highest first (earlier pages win a tie); with no spec-like page at all, the
 * first pages. A page that does not fit whole is cut at a line break, and only
 * when it is the first page chosen — otherwise it is left for a smaller one.
 */
export function manualDigest(source: DigestSource, maxChars: number): string {
  const parts: string[] = [];
  let budget = maxChars;

  if (source.outline.length > 0) {
    const outline = formatOutline(source.outline, Math.floor(maxChars * OUTLINE_SHARE));
    if (outline) {
      const block = `Contents:\n${outline}`;
      parts.push(block);
      budget -= block.length + 2;
    }
  }

  const pages = source.pages.filter((page) => page.text.trim().length > 0);
  const favoured = specSectionPages(source.outline);
  const scored = pages.map((page, index) => ({
    page,
    index,
    score: specScore(page.text) + (favoured.has(page.pageNumber) ? SPEC_SECTION_BONUS : 0),
  }));
  const anySpecs = scored.some((entry) => entry.score > 0);
  const order = anySpecs
    ? scored.filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score || a.index - b.index)
    : scored;

  const chosen: { index: number; text: string }[] = [];
  for (const entry of order) {
    if (budget <= 200) break;
    const block = `${pageHeading(entry.page)}\n${entry.page.text.trim()}`;
    if (block.length + 2 <= budget) {
      chosen.push({ index: entry.index, text: block });
      budget -= block.length + 2;
    } else if (chosen.length === 0) {
      const cut = block.slice(0, budget - 30);
      const at = cut.lastIndexOf("\n");
      chosen.push({ index: entry.index, text: `${(at > budget * 0.5 ? cut.slice(0, at) : cut).trimEnd()}\n…[page cut]` });
      budget = 0;
    }
  }
  chosen.sort((a, b) => a.index - b.index);
  parts.push(...chosen.map((entry) => entry.text));
  return parts.join("\n\n");
}
