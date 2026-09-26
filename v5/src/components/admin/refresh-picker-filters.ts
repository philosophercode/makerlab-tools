/**
 * What `/admin/refresh`'s **Refresh research…** picker narrows by (amendment
 * 2026-09-25 "Admin polish"): three presets that name the reasons a tool is
 * worth researching again, a category, and a name search. Presets combine —
 * "never reviewed" and "no manual" is the tools that are both.
 *
 * Pure and directive-free, so the page, the island and the tests share it.
 */

export const PICKER_PRESETS = ["neverReviewed", "noManual", "stale"] as const;
export type PickerPreset = (typeof PICKER_PRESETS)[number];

/** "Not refreshed in 90 days": never refreshed counts too. */
export const STALE_AFTER_DAYS = 90;

/** One tool the picker offers — every catalogue tool except archived ones. */
export interface PickerTool {
  id: string;
  name: string;
  officialName: string | null;
  categoryName: string | null;
  noManual: boolean;
  neverReviewed: boolean;
  /** ISO time a refresh of it was last requested, or null when never. */
  lastRefreshedAt: string | null;
  /** A refresh is already open: queueing it again would be skipped, so it cannot be chosen. */
  refreshOpen: boolean;
}

export interface PickerFilters {
  presets: readonly PickerPreset[];
  /** A category name, or null for any. */
  category: string | null;
  query: string;
}

export const NO_PICKER_FILTERS: PickerFilters = { presets: [], category: null, query: "" };

export function isStale(tool: PickerTool, now: Date): boolean {
  if (!tool.lastRefreshedAt) return true;
  return now.getTime() - new Date(tool.lastRefreshedAt).getTime() >= STALE_AFTER_DAYS * 86_400_000;
}

export function matchesPreset(tool: PickerTool, preset: PickerPreset, now: Date): boolean {
  switch (preset) {
    case "neverReviewed":
      return tool.neverReviewed;
    case "noManual":
      return tool.noManual;
    case "stale":
      return isStale(tool, now);
  }
}

export function matchesPicker(tool: PickerTool, filters: PickerFilters, now: Date): boolean {
  if (filters.category !== null && tool.categoryName !== filters.category) return false;
  if (!filters.presets.every((preset) => matchesPreset(tool, preset, now))) return false;
  const query = filters.query.trim().toLowerCase();
  if (query && !`${tool.name} ${tool.officialName ?? ""}`.toLowerCase().includes(query)) return false;
  return true;
}

/** The categories the picker offers, sorted, each once. */
export function pickerCategories(tools: readonly PickerTool[]): string[] {
  return [...new Set(tools.map((tool) => tool.categoryName).filter((name): name is string => Boolean(name)))].sort((a, b) =>
    a.localeCompare(b)
  );
}
