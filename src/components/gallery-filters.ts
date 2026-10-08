import type { GalleryTool, ToolStatus } from "./catalog-types";
import { TOOL_ITEM_KIND, type ToolItemKind } from "../lib/db/schema/vocabulary";

/**
 * What the gallery is showing, and how that survives a link (UI system phase
 * 5a; owner request 2026-09-25 "Sort and Group by").
 *
 * Directive-free on purpose, like `admin/inventory-filters.ts`: the island
 * imports it and so do the tests. **Every choice lives in the URL** — search,
 * the five facets (status, category, material, location, item kind), the view, the sort and the grouping — so "the woodshop,
 * grouped by category, as a table" is a link somebody can send.
 *
 * Parsing drops anything the gallery does not offer (a hand-edited
 * `?sort=price` sorts by the default), and a repeated parameter takes its
 * first value.
 */

export const GALLERY_VIEWS = ["grid", "table"] as const;
export type GalleryView = (typeof GALLERY_VIEWS)[number];

/**
 * What the home page browses (student home spec, amendment "One page: the
 * list at rest", revised): the **categories** as tiles — the default, nothing
 * in the URL — or **all** tools. Not to be confused with `view`, which is how
 * a list of tools is drawn (grid or table).
 */
export const GALLERY_SHOWS = ["categories", "all"] as const;
export type GalleryShow = (typeof GALLERY_SHOWS)[number];

/**
 * The sort keys. The default (`null`) is the catalogue's own order, name A–Z —
 * or, while searching, best match first. `name` is offered as an explicit
 * choice only while searching, where it differs from the default.
 */
export const GALLERY_SORTS = ["name", "name-desc", "category", "location", "recent", "available"] as const;
export type GallerySort = (typeof GALLERY_SORTS)[number];

/**
 * The groupings. `category` is the catalogue's category (`categories.name`,
 * e.g. "FDM"), ordered and labelled within its group ("3D Printing › FDM");
 * `categoryGroup` is the group itself ("3D Printing") — the gallery cards'
 * tag; `location` is the room; `none` is one list.
 *
 * Since the list became the home page (student home spec, amendment "One
 * page: the list at rest", 2026-10-07) it rests **grouped by category group,
 * in the lab's order** (`DEFAULT_GALLERY_GROUP`): `group: null` in the state,
 * and nothing in the URL. `?group=none` asks for one list.
 */
export const GALLERY_GROUPS = ["category", "categoryGroup", "location", "none"] as const;
export type GalleryGroup = (typeof GALLERY_GROUPS)[number];

/** The grouping the list rests in when the URL names none. */
export const DEFAULT_GALLERY_GROUP = "categoryGroup" satisfies GalleryGroup;

/** The grouping `groupTools` draws for a state's `group`: the default for `null`, none for `"none"`. */
export function resolvedGroup(group: GalleryGroup | null): Exclude<GalleryGroup, "none"> | null {
  if (group === null) return DEFAULT_GALLERY_GROUP;
  return group === "none" ? null : group;
}

/** The tool statuses a Status facet offers, in the order they read. */
export const GALLERY_STATUSES: readonly ToolStatus[] = ["Available", "In Use", "Training Required", "Offline"];

export interface GalleryState {
  query: string;
  /** `GalleryTool.status` — availability (public polish). */
  status: ToolStatus | null;
  /** `GalleryTool.category` — the category group the cards are tagged with. */
  category: string | null;
  material: string | null;
  /** `GalleryTool.location` — the room. */
  location: string | null;
  /** `GalleryTool.itemKind` (taxonomy v2 facet): equipment, accessory, consumable or fixture. */
  kind: ToolItemKind | null;
  /** Categories (tiles) or all tools; see `GALLERY_SHOWS`. */
  show: GalleryShow;
  view: GalleryView;
  sort: GallerySort | null;
  /** `null` is the default grouping (`DEFAULT_GALLERY_GROUP`); see `resolvedGroup`. */
  group: GalleryGroup | null;
}

export const DEFAULT_GALLERY_STATE: GalleryState = {
  query: "",
  status: null,
  category: null,
  material: null,
  location: null,
  kind: null,
  show: "categories",
  view: "grid",
  sort: null,
  group: null,
};

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

function read(params: Params, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function oneOf<T extends string>(allowed: readonly T[], value: string | undefined): T | null {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

export function parseGalleryState(params: Params): GalleryState {
  return {
    query: read(params, "q")?.slice(0, 120) ?? "",
    status: oneOf(GALLERY_STATUSES, read(params, "status")),
    category: read(params, "category") || null,
    material: read(params, "material") || null,
    location: read(params, "location") || null,
    kind: oneOf(TOOL_ITEM_KIND, read(params, "kind")),
    show: oneOf(GALLERY_SHOWS, read(params, "show")) ?? "categories",
    view: oneOf(GALLERY_VIEWS, read(params, "view")) ?? "grid",
    sort: oneOf(GALLERY_SORTS, read(params, "sort")),
    group: defaultAsNull(oneOf(GALLERY_GROUPS, read(params, "group"))),
  };
}

/** An old link's explicit `?group=categoryGroup` is the default now, kept out of the URL. */
function defaultAsNull(group: GalleryGroup | null): GalleryGroup | null {
  return group === DEFAULT_GALLERY_GROUP ? null : group;
}

/** The state as a query string; defaults are left out, never sent blank. */
export function toGallerySearchParams(state: GalleryState): URLSearchParams {
  const params = new URLSearchParams();
  // What is browsed first: `/?show=all&material=Plywood` reads as it is.
  if (state.show !== "categories") params.set("show", state.show);
  // Not trimmed: the search box is controlled by the URL, and trimming would eat the space being typed.
  if (state.query) params.set("q", state.query);
  if (state.status) params.set("status", state.status);
  if (state.category) params.set("category", state.category);
  if (state.material) params.set("material", state.material);
  if (state.location) params.set("location", state.location);
  if (state.kind) params.set("kind", state.kind);
  if (state.view !== "grid") params.set("view", state.view);
  if (state.sort) params.set("sort", state.sort);
  if (state.group) params.set("group", state.group);
  return params;
}

/**
 * The tools the gallery shows before any facet (taxonomy v2 spec §4.9): a tool
 * whose category the lab hides from the public gallery by default (Shop
 * Infrastructure & Supplies — benches, batteries, sanding sheets) is left out,
 * **unless** the Category facet names that category — so it is one click
 * away, never gone. Its own page and the assistant's search still find it.
 */
export function visibleInGallery<T extends Pick<GalleryTool, "category" | "galleryHidden">>(
  tools: readonly T[],
  state: Pick<GalleryState, "category">
): T[] {
  return tools.filter((tool) => !tool.galleryHidden || (state.category !== null && tool.category === state.category));
}

/** True while a facet narrows the gallery (search is said separately). */
export function hasFacetFilters(state: GalleryState): boolean {
  return Boolean(state.status || state.category || state.material || state.location || state.kind);
}

// ── Sorting ─────────────────────────────────────────────────────────

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/** Units a student could walk up to now. */
export function availableUnits(tool: GalleryTool): number {
  return tool.units.filter((unit) => unit.status === "Available").length;
}

/**
 * The tools in the chosen order. `tools` arrives in the default order (the
 * catalogue's name order, or search rank), which every other sort keeps as its
 * tie-break — a stable sort — so equal keys never shuffle between renders.
 */
export function sortTools<T extends GalleryTool>(tools: readonly T[], sort: GallerySort | null): T[] {
  const out = tools.slice();
  switch (sort) {
    case null:
      return out;
    case "name":
      return out.sort((a, b) => collator.compare(a.name, b.name));
    case "name-desc":
      return out.sort((a, b) => collator.compare(b.name, a.name));
    case "category":
      return out.sort(
        (a, b) =>
          collator.compare(a.category, b.category) ||
          collator.compare(a.categorySub, b.categorySub) ||
          collator.compare(a.name, b.name)
      );
    case "location":
      return out.sort(
        (a, b) => collator.compare(a.location, b.location) || collator.compare(a.zone, b.zone) || collator.compare(a.name, b.name)
      );
    case "recent":
      // Newest first; a tool with no recorded date sorts last.
      return out.sort((a, b) => (b.addedAt ?? "").localeCompare(a.addedAt ?? ""));
    case "available":
      return out.sort((a, b) => availableUnits(b) - availableUnits(a));
  }
}

// ── Grouping ────────────────────────────────────────────────────────

export interface ToolSection<T extends GalleryTool = GalleryTool> {
  /** Stable, URL-safe-ish id for the section's heading. */
  key: string;
  /** The section's label, as data (category and room names are data, not messages). */
  label: string;
  tools: T[];
}

/** Values the catalogue uses for "not recorded", which group last. */
const UNKNOWN = new Set(["Uncategorized", "Unknown", "Other", ""]);

/**
 * Top-level category names in the lab's own order (`order`: the taxonomy's
 * `sort_order`, from `getCategoryOrder`), then any name the order does not
 * know alphabetically, "not recorded" last. The list's groups, its category
 * chips and the category tiles all use it.
 */
export function compareCategoryNames(order: readonly string[]): (a: string, b: string) => number {
  const rank = new Map(order.map((name, index) => [name, index]));
  return (a, b) => {
    const unknown = Number(UNKNOWN.has(a)) - Number(UNKNOWN.has(b));
    if (unknown !== 0) return unknown;
    const ra = rank.get(a) ?? Number.POSITIVE_INFINITY;
    const rb = rank.get(b) ?? Number.POSITIVE_INFINITY;
    if (ra !== rb) return ra - rb;
    return collator.compare(a, b);
  };
}

function groupKeyOf(tool: GalleryTool, group: Exclude<GalleryGroup, "none">): { key: string; label: string; order: string[] } {
  switch (group) {
    case "categoryGroup":
      return { key: tool.category, label: tool.category, order: [tool.category] };
    case "category":
      return {
        key: `${tool.category}\u0000${tool.categorySub}`,
        label: UNKNOWN.has(tool.category) || tool.category === tool.categorySub ? tool.categorySub : `${tool.category} › ${tool.categorySub}`,
        order: [tool.category, tool.categorySub],
      };
    case "location":
      return { key: tool.location, label: tool.location, order: [tool.location] };
  }
}

function compareOrder(a: string[], b: string[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? "";
    const y = b[i] ?? "";
    const unknown = Number(UNKNOWN.has(x)) - Number(UNKNOWN.has(y));
    if (unknown !== 0) return unknown;
    const order = collator.compare(x, y);
    if (order !== 0) return order;
  }
  return 0;
}

/**
 * The tools as labelled sections, in order (alphabetical, "not recorded"
 * last), each keeping the order the tools arrived in — so the sort applies
 * inside every section. `null` is one unlabelled section.
 *
 * With `categoryOrder` (the taxonomy's top-level order, `getCategoryOrder`),
 * the category groupings follow the lab's order rather than the alphabet:
 * the sections of `categoryGroup`, and the groups `category` sits within.
 */
export function groupTools<T extends GalleryTool>(
  tools: readonly T[],
  group: Exclude<GalleryGroup, "none"> | null,
  options: { categoryOrder?: readonly string[] } = {}
): ToolSection<T>[] {
  if (!group) return [{ key: "all", label: "", tools: tools.slice() }];
  const sections = new Map<string, ToolSection<T> & { order: string[] }>();
  for (const tool of tools) {
    const { key, label, order } = groupKeyOf(tool, group);
    const section = sections.get(key);
    if (section) section.tools.push(tool);
    else sections.set(key, { key, label, order, tools: [tool] });
  }
  const byCategory = options.categoryOrder && group !== "location" ? compareCategoryNames(options.categoryOrder) : null;
  return Array.from(sections.values())
    .sort((a, b) => (byCategory ? byCategory(a.order[0], b.order[0]) : 0) || compareOrder(a.order, b.order))
    .map(({ key, label, tools: members }) => ({ key, label, tools: members }));
}
