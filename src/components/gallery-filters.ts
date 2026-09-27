import type { MakerLabTool, ToolStatus } from "./catalog-types";

/**
 * What the gallery is showing, and how that survives a link (UI system phase
 * 5a; owner request 2026-09-25 "Sort and Group by").
 *
 * Directive-free on purpose, like `admin/inventory-filters.ts`: the island
 * imports it and so do the tests. **Every choice lives in the URL** — search,
 * the four facets (status, category, material, location), the view, the sort and the grouping — so "the woodshop,
 * grouped by category, as a table" is a link somebody can send.
 *
 * Parsing drops anything the gallery does not offer (a hand-edited
 * `?sort=price` sorts by the default), and a repeated parameter takes its
 * first value.
 */

export const GALLERY_VIEWS = ["grid", "table"] as const;
export type GalleryView = (typeof GALLERY_VIEWS)[number];

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
 * tag; `location` is the room.
 */
export const GALLERY_GROUPS = ["category", "categoryGroup", "location"] as const;
export type GalleryGroup = (typeof GALLERY_GROUPS)[number];

/** The tool statuses a Status facet offers, in the order they read. */
export const GALLERY_STATUSES: readonly ToolStatus[] = ["Available", "In Use", "Training Required", "Offline"];

export interface GalleryState {
  query: string;
  /** `MakerLabTool.status` — availability (public polish). */
  status: ToolStatus | null;
  /** `MakerLabTool.category` — the category group the cards are tagged with. */
  category: string | null;
  material: string | null;
  /** `MakerLabTool.location` — the room. */
  location: string | null;
  view: GalleryView;
  sort: GallerySort | null;
  group: GalleryGroup | null;
}

export const DEFAULT_GALLERY_STATE: GalleryState = {
  query: "",
  status: null,
  category: null,
  material: null,
  location: null,
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
    view: oneOf(GALLERY_VIEWS, read(params, "view")) ?? "grid",
    sort: oneOf(GALLERY_SORTS, read(params, "sort")),
    group: oneOf(GALLERY_GROUPS, read(params, "group")),
  };
}

/** The state as a query string; defaults are left out, never sent blank. */
export function toGallerySearchParams(state: GalleryState): URLSearchParams {
  const params = new URLSearchParams();
  // Not trimmed: the search box is controlled by the URL, and trimming would eat the space being typed.
  if (state.query) params.set("q", state.query);
  if (state.status) params.set("status", state.status);
  if (state.category) params.set("category", state.category);
  if (state.material) params.set("material", state.material);
  if (state.location) params.set("location", state.location);
  if (state.view !== "grid") params.set("view", state.view);
  if (state.sort) params.set("sort", state.sort);
  if (state.group) params.set("group", state.group);
  return params;
}

/** True while a facet narrows the gallery (search is said separately). */
export function hasFacetFilters(state: GalleryState): boolean {
  return Boolean(state.status || state.category || state.material || state.location);
}

// ── Sorting ─────────────────────────────────────────────────────────

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/** Units a student could walk up to now. */
export function availableUnits(tool: MakerLabTool): number {
  return tool.units.filter((unit) => unit.status === "Available").length;
}

/**
 * The tools in the chosen order. `tools` arrives in the default order (the
 * catalogue's name order, or search rank), which every other sort keeps as its
 * tie-break — a stable sort — so equal keys never shuffle between renders.
 */
export function sortTools(tools: readonly MakerLabTool[], sort: GallerySort | null): MakerLabTool[] {
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

export interface ToolSection {
  /** Stable, URL-safe-ish id for the section's heading. */
  key: string;
  /** The section's label, as data (category and room names are data, not messages). */
  label: string;
  tools: MakerLabTool[];
}

/** Values the catalogue uses for "not recorded", which group last. */
const UNKNOWN = new Set(["Uncategorized", "Unknown", "Other", ""]);

function groupKeyOf(tool: MakerLabTool, group: GalleryGroup): { key: string; label: string; order: string[] } {
  switch (group) {
    case "categoryGroup":
      return { key: tool.category, label: tool.category, order: [tool.category] };
    case "category":
      return {
        key: `${tool.category}\u0000${tool.categorySub}`,
        label: UNKNOWN.has(tool.category) ? tool.categorySub : `${tool.category} › ${tool.categorySub}`,
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
 */
export function groupTools(tools: readonly MakerLabTool[], group: GalleryGroup | null): ToolSection[] {
  if (!group) return [{ key: "all", label: "", tools: tools.slice() }];
  const sections = new Map<string, ToolSection & { order: string[] }>();
  for (const tool of tools) {
    const { key, label, order } = groupKeyOf(tool, group);
    const section = sections.get(key);
    if (section) section.tools.push(tool);
    else sections.set(key, { key, label, order, tools: [tool] });
  }
  return Array.from(sections.values())
    .sort((a, b) => compareOrder(a.order, b.order))
    .map(({ key, label, tools: members }) => ({ key, label, tools: members }));
}
