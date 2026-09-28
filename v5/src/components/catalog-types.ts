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
  category: string;
  categorySub: string;
  location: string;
  zone: string;
  trainingLevel: "Beginner" | "Intermediate" | "Advanced";
  trainingLabel: string;
  status: ToolStatus;
  shortDescription: string;
  description: string;
  imageSrc: string;
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
