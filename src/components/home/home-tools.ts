import type { MakerLabTool, MakerLabUnit } from "../catalog-types";
import { visibleInGallery } from "../gallery-filters";

/**
 * What the home page reads of a tool (student home spec 2026-10-07 §4): the
 * smart search's rows and the category tiles. Smaller than a `GalleryTool`
 * (no description, PPE, materials or tags): the home page sends only this.
 */
export type HomeTool = Pick<
  MakerLabTool,
  "id" | "slug" | "name" | "officialName" | "category" | "categorySub" | "status" | "imageSrc" | "thumbnails" | "galleryHidden" | "itemKind"
> & {
  units: Array<Pick<MakerLabUnit, "status">>;
};

export function toHomeTool(tool: MakerLabTool): HomeTool {
  return {
    id: tool.id,
    slug: tool.slug,
    name: tool.name,
    officialName: tool.officialName ?? null,
    category: tool.category,
    categorySub: tool.categorySub,
    status: tool.status,
    imageSrc: tool.imageSrc,
    thumbnails: tool.thumbnails ?? null,
    galleryHidden: Boolean(tool.galleryHidden),
    itemKind: tool.itemKind ?? "equipment",
    units: tool.units.map((unit) => ({ status: unit.status })),
  };
}

export interface CategoryTile {
  /** The top-level category, as the full list's Category filter names it. */
  name: string;
  /** Tools in it (the gallery's own count: hidden categories are not tiles). */
  count: number;
  /** Its second-level categories, in the lab's order of first appearance, at most three. */
  subs: string[];
  /** More second-level categories than `subs` shows. */
  moreSubs: boolean;
  /** Units out of service across its tools. */
  unitsDown: number;
  /** The tool whose photo stands for the category, or null when none has one. */
  cover: Pick<HomeTool, "name" | "imageSrc" | "thumbnails"> | null;
}

const UNKNOWN = new Set(["", "Uncategorized", "Unknown", "Other"]);
const MAX_SUBS = 3;

/**
 * The home page's category tiles: one per top-level category the public
 * gallery shows (taxonomy v2; a category hidden by default, such as Shop
 * Infrastructure & Supplies, gets no tile and stays on the full list), in
 * the lab's own order (`order`, the taxonomy's `sort_order`), then any
 * category the order does not name alphabetically, "not recorded" last.
 *
 * The cover is a photo from the category's equipment: the tool with the most
 * units, so a category is shown by the machine people come for, not by a
 * battery or a blade.
 */
export function categoryTiles(tools: readonly HomeTool[], order: readonly string[]): CategoryTile[] {
  const shown = visibleInGallery(tools, { category: null });
  const byCategory = new Map<string, HomeTool[]>();
  for (const tool of shown) {
    const list = byCategory.get(tool.category) ?? [];
    list.push(tool);
    byCategory.set(tool.category, list);
  }
  const rank = new Map(order.map((name, index) => [name, index]));
  const names = Array.from(byCategory.keys()).sort((a, b) => {
    const unknown = Number(UNKNOWN.has(a)) - Number(UNKNOWN.has(b));
    if (unknown !== 0) return unknown;
    const ra = rank.get(a) ?? Number.POSITIVE_INFINITY;
    const rb = rank.get(b) ?? Number.POSITIVE_INFINITY;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
  return names.map((name) => {
    const members = byCategory.get(name)!;
    const subs: string[] = [];
    for (const tool of members) {
      if (tool.categorySub && tool.categorySub !== name && !subs.includes(tool.categorySub)) subs.push(tool.categorySub);
    }
    return {
      name,
      count: members.length,
      subs: subs.slice(0, MAX_SUBS),
      moreSubs: subs.length > MAX_SUBS,
      unitsDown: members.reduce((sum, tool) => sum + tool.units.filter((unit) => unit.status === "Offline").length, 0),
      cover: coverOf(members),
    };
  });
}

function coverOf(members: readonly HomeTool[]): CategoryTile["cover"] {
  const withPhoto = members.filter((tool) => tool.imageSrc);
  if (withPhoto.length === 0) return null;
  const best = withPhoto
    .map((tool, index) => ({ tool, index }))
    .sort(
      (a, b) =>
        Number((b.tool.itemKind ?? "equipment") === "equipment") - Number((a.tool.itemKind ?? "equipment") === "equipment") ||
        b.tool.units.length - a.tool.units.length ||
        a.index - b.index
    )[0].tool;
  return { name: best.name, imageSrc: best.imageSrc, thumbnails: best.thumbnails ?? null };
}

/** The count the home page states ("Search 77 tools", "See all 77 tools"): what the full list shows unfiltered. */
export function galleryToolCount(tools: readonly HomeTool[]): number {
  return visibleInGallery(tools, { category: null }).length;
}
