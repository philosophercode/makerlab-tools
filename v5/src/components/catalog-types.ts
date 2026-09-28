import type { ImageThumbnails } from "../lib/images/thumbnail-urls.ts";

export type ToolStatus = "Available" | "In Use" | "Training Required" | "Offline";

export interface MakerLabUnit {
  id: string;
  name: string;
  serial: string;
  status: ToolStatus;
  condition: "Excellent" | "Good" | "Service Soon" | "Offline";
  location: string;
  dateAcquired: string | null;
}

export interface MakerLabTool {
  id: string;
  slug: string;
  /** The display name (tool display names spec 2026-09-24): short, what people say. */
  name: string;
  /**
   * The official name — full product name with model or part number — or
   * null/absent when none is recorded. Shown under the tool page's title when
   * it differs; searched beside the name.
   */
  officialName?: string | null;
  /** The top-level category (taxonomy v2: the parent's name), or a pre-v2 row's group. */
  category: string;
  /** The category itself — the second level, or the top-level name when it has none. */
  categorySub: string;
  /** The category's slug (taxonomy v2); absent on fixtures from before it. */
  categorySlug?: string | null;
  /**
   * The category is left out of the public gallery by default (Shop
   * Infrastructure & Supplies). Its page, search and staff surfaces still
   * show it; choosing its category in the gallery's facet shows it too.
   */
  galleryHidden?: boolean;
  location: string;
  zone: string;
  trainingLevel: "Beginner" | "Intermediate" | "Advanced";
  trainingLabel: string;
  status: ToolStatus;
  shortDescription: string;
  description: string;
  /** The original image, or "" when the tool has none. */
  imageSrc: string;
  /**
   * Pre-rendered AVIF/WebP widths of `imageSrc` (`lib/images/thumbnail-urls`),
   * which `ToolImage` shows instead of it; null/absent when there are none.
   */
  thumbnails?: ImageThumbnails | null;
  ppe: string[];
  materials: string[];
  tags: string[];
  emergencyStop: string | null;
  useRestrictions: string | null;
  mapId: string | null;
  notes: string | null;
  links: Array<{
    label: string;
    href: string;
    kind?: string;
    description?: string;
    /**
     * The manufacturer's link, when `href` is the archived copy of it in Blob
     * (the manual archive). Kept so a caller can still name the original.
     */
    sourceHref?: string;
    /**
     * The lab's own document an import carried through (bulk intake spec
     * §3.4): shown as *Lab document*, above the manufacturer's links, and
     * never fetched — not by the assistant's `read_page`, not by anything.
     */
    labDocument?: true;
  }>;
  units: MakerLabUnit[];
  /**
   * The assistant's starter chips on this tool's page (spec amendment
   * "Tool-specific starter questions"), English as researched or as staff
   * wrote them. Absent or empty means the chat's generic chips.
   */
  starterQuestions?: string[];
  /**
   * When the tool was added to the catalogue (ISO), for the gallery's
   * "Recently added" sort (UI system phase 5a). Null or absent when unknown;
   * such tools sort last.
   */
  addedAt?: string | null;
}

/**
 * What the gallery reads of a tool — its cards, table, search, facets, sorts
 * and groups — and so all the home page sends to the browser for each one
 * (`toGalleryTool`). The rest of a `MakerLabTool` (links, notes, safety text,
 * unit details, starter questions) belongs to the tool's own page; sending it
 * for every tool made the home page's HTML several times larger.
 */
export type GalleryTool = Pick<
  MakerLabTool,
  | "id"
  | "slug"
  | "name"
  | "officialName"
  | "category"
  | "categorySub"
  | "location"
  | "zone"
  | "trainingLevel"
  | "status"
  | "description"
  | "imageSrc"
  | "thumbnails"
  | "ppe"
  | "materials"
  | "tags"
  | "addedAt"
  | "galleryHidden"
> & {
  /** Only each unit's status: the table's "available" count and the availability sort. */
  units: Array<Pick<MakerLabUnit, "status">>;
};

export function toGalleryTool(tool: MakerLabTool): GalleryTool {
  return {
    id: tool.id,
    slug: tool.slug,
    name: tool.name,
    officialName: tool.officialName ?? null,
    category: tool.category,
    categorySub: tool.categorySub,
    location: tool.location,
    zone: tool.zone,
    trainingLevel: tool.trainingLevel,
    status: tool.status,
    description: tool.description,
    imageSrc: tool.imageSrc,
    thumbnails: tool.thumbnails ?? null,
    ppe: tool.ppe,
    materials: tool.materials,
    tags: tool.tags,
    addedAt: tool.addedAt ?? null,
    galleryHidden: Boolean(tool.galleryHidden),
    units: tool.units.map((unit) => ({ status: unit.status })),
  };
}

export interface CatalogStats {
  toolsInInventory: number;
  labHours: string;
}

export interface ProjectToolRef {
  id: string;
  name: string;
  slug: string;
}

export interface MakerLabProject {
  id: string;
  /** Readable URL key, assigned once from the title; `/projects/<slug>`. */
  slug: string;
  title: string;
  author: string;
  /** Markdown write-up (rendered with react-markdown + remark-gfm). */
  body: string;
  /** First photo is treated as the cover. */
  photos: string[];
  tools: ProjectToolRef[];
  link: string | null;
  materials: string[];
  date: string | null;
}
