import { paletteScore } from "./palette-match";

/**
 * What the ⌘K palette and the home page's smart search share (student home
 * spec 2026-10-07 §3): the words a tool is found by, the category list with
 * counts, and ranking by the palette's matcher. One search, two places to
 * type it: the palette in a dialog on every page, the smart search inline on
 * the home page.
 */

/** A tool as either search sees it. */
export interface SearchableTool {
  name: string;
  officialName?: string | null;
  slug: string;
  /** The top-level category the gallery filters on. */
  category?: string | null;
  /** The second-level category; matched by the category rows, not by the tool. */
  categorySub?: string | null;
}

/** A tool is found by its display name, its official name and its slug (UI system spec §7.5). */
export function toolKeywords(tool: SearchableTool): string[] {
  return [tool.name, tool.officialName ?? "", tool.slug];
}

export interface CategoryEntry {
  name: string;
  count: number;
  /** The second-level categories under it, so "resin" finds 3D Printing. */
  subs: string[];
}

/**
 * The top-level categories the tools fall in, each with its count and its
 * second-level names, alphabetical. A link to the full list filtered to it.
 */
export function categoryEntries(tools: readonly SearchableTool[]): CategoryEntry[] {
  const entries = new Map<string, { count: number; subs: Set<string> }>();
  for (const tool of tools) {
    if (!tool.category) continue;
    const entry = entries.get(tool.category) ?? { count: 0, subs: new Set<string>() };
    entry.count += 1;
    if (tool.categorySub && tool.categorySub !== tool.category) entry.subs.add(tool.categorySub);
    entries.set(tool.category, entry);
  }
  return Array.from(entries.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, { count, subs }]) => ({ name, count, subs: Array.from(subs).sort((a, b) => a.localeCompare(b)) }));
}

export function categoryKeywords(entry: CategoryEntry): string[] {
  return [entry.name, ...entry.subs];
}

/**
 * The items that match `query` by the palette's rules (`paletteScore`: every
 * word must appear, no fuzzy matching), best first, at most `limit`. Ties keep
 * the order the items arrived in. An empty query matches nothing: an empty box
 * lists nothing.
 */
export function rankByPaletteScore<T>(
  items: readonly T[],
  query: string,
  keywordsOf: (item: T) => readonly string[],
  limit: number
): T[] {
  if (!query.trim()) return [];
  return items
    .map((item, index) => ({ item, index, score: paletteScore(query, keywordsOf(item)) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.item);
}
