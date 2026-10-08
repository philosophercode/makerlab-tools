import type { GalleryTool } from "./catalog-types";
import {
  compareCategoryNames,
  groupTools,
  resolvedGroup,
  sortTools,
  visibleInGallery,
  type GalleryState,
  type ToolSection,
} from "./gallery-filters";
import { rankToolsInPlace } from "./palette/palette-search";

/**
 * What the home page's list shows for a state (student home spec 2026-10-07,
 * amendment "One page: the list at rest"). Directive-free, like
 * `gallery-filters.ts`, so the page island and the tests share it.
 *
 * - **At rest** (nothing typed): the tools the gallery shows, narrowed by the
 *   facets, in sections — by category group in the lab's order unless the
 *   URL asks for another grouping.
 * - **Searching**: the matching tools, ranked (`rankToolsInPlace`, the ⌘K
 *   palette's matcher), as one list in place of the sections. The search
 *   reaches every tool, a category hidden from the gallery by default
 *   included, as the smart search did.
 */

export type Facet = "status" | "category" | "material" | "location" | "kind";
export const FACETS: readonly Facet[] = ["status", "category", "material", "location", "kind"];

export function matchesFacet(tool: GalleryTool, facet: Facet, value: string): boolean {
  if (facet === "status") return tool.status === value;
  if (facet === "category") return tool.category === value;
  if (facet === "material") return tool.materials.includes(value);
  if (facet === "kind") return (tool.itemKind ?? "equipment") === value;
  return tool.location === value;
}

/** The rows every facet but `except` leaves — what a facet's counts are taken over. */
export function narrowed<T extends GalleryTool>(tools: readonly T[], state: GalleryState, except?: Facet): T[] {
  return tools.filter((tool) =>
    FACETS.every((facet) => facet === except || !state[facet] || matchesFacet(tool, facet, state[facet]!))
  );
}

export interface CatalogueView<T extends GalleryTool = GalleryTool> {
  /** What the list holds before any filter: hidden-by-default categories out unless chosen. The count's "of N". */
  visible: T[];
  /** The tools on the page, in order: every section's, or the results. */
  shown: T[];
  /** At rest, the sections (one unlabelled one when ungrouped); searching, one section of results. */
  sections: ToolSection<T>[];
  /** Something is typed: the results replace the sections. */
  searching: boolean;
}

export function catalogueView<T extends GalleryTool>(
  tools: readonly T[],
  state: GalleryState,
  categoryOrder: readonly string[]
): CatalogueView<T> {
  const visible = visibleInGallery(tools, state);
  const query = state.query.trim();
  if (query) {
    // Best match first — the gallery's own tools before a hidden-by-default
    // category's (a printer's toner is not what "laser" is looking for), and
    // equipment before its accessories on an equal match. An explicit sort
    // reorders the results.
    const faceted = narrowed(tools, state);
    const ranked = [
      ...rankToolsInPlace(faceted.filter((tool) => !tool.galleryHidden), query, byKind),
      ...rankToolsInPlace(faceted.filter((tool) => tool.galleryHidden), query, byKind),
    ];
    const shown = sortTools(ranked, state.sort);
    return { visible, shown, sections: [{ key: "results", label: "", tools: shown }], searching: true };
  }
  const shown = sortTools(narrowed(visible, state), state.sort);
  const sections = groupTools(shown, resolvedGroup(state.group), { categoryOrder });
  return { visible, shown: sections.flatMap((section) => section.tools), sections, searching: false };
}

/** On an equal match: equipment, then fixtures, then what goes with a machine (accessories, consumables). */
const KIND_ORDER = ["equipment", "fixture", "accessory", "consumable"];
function byKind(a: GalleryTool, b: GalleryTool): number {
  return KIND_ORDER.indexOf(a.itemKind ?? "equipment") - KIND_ORDER.indexOf(b.itemKind ?? "equipment");
}

export interface CategoryChip {
  /** The top-level category, as the Category filter names it. */
  name: string;
  /** Its tools the other filters leave. */
  count: number;
}

/**
 * The category chips under the search: every top-level category in the
 * lab's order, each with the count the other facets leave (so the numbers
 * agree with the list a chip would show). A category the gallery hides by
 * default (Shop Infrastructure & Supplies) comes last: it is one tap away,
 * never gone. The search text does not change the counts.
 */
export function categoryChips(tools: readonly GalleryTool[], state: GalleryState, categoryOrder: readonly string[]): CategoryChip[] {
  const counts = new Map<string, number>();
  const shownByDefault = new Set<string>();
  const named = tools.filter((tool) => tool.category);
  for (const tool of named) {
    if (!counts.has(tool.category)) counts.set(tool.category, 0);
    if (!tool.galleryHidden) shownByDefault.add(tool.category);
  }
  for (const tool of narrowed(named, state, "category")) counts.set(tool.category, (counts.get(tool.category) ?? 0) + 1);
  const compare = compareCategoryNames(categoryOrder);
  return Array.from(counts.keys())
    .sort((a, b) => Number(!shownByDefault.has(a)) - Number(!shownByDefault.has(b)) || compare(a, b))
    .map((name) => ({ name, count: counts.get(name) ?? 0 }));
}
