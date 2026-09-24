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
  name: string;
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
  }>;
  units: MakerLabUnit[];
  /**
   * The assistant's starter chips on this tool's page (spec amendment
   * "Tool-specific starter questions"), English as researched or as staff
   * wrote them. Absent or empty means the chat's generic chips.
   */
  starterQuestions?: string[];
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
