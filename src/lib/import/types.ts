/**
 * The shapes bulk intake passes around (bulk intake spec §3, §4).
 *
 * Client-safe and plain Node: the review table, the routes, the chat tool and
 * the document workflow's steps all speak these. No imports.
 */

/** A link to the lab's own material — a Google Doc, an SOP. Never fetched (§3.4). */
export interface LabDoc {
  title: string;
  url: string;
}

/** A product or manual link a row gave for its item, offered as a resource at approval. */
export interface ImportLink {
  url: string;
}

/** How sure the Suggest names pass is (§3.3). */
export type SuggestionConfidence = "exact" | "likely" | "unsure";

/** The Suggest names pass's answer for one item, waiting for Accept or Ignore. */
export interface NameSuggestion {
  /** The official name — brand and model as the manufacturer writes them. */
  canonicalName: string;
  /**
   * The short display name (tool display names spec §5.4), already through
   * the display guard. Absent on suggestions made before the two names.
   */
  displayName?: string;
  brand: string | null;
  confidence: SuggestionConfidence;
  sourceUrl: string | null;
  /** ISO time the suggestion was made. */
  suggestedAt: string;
}

/**
 * One item as a parser or the extractor produced it, before validation: every
 * field optional but the name, values as the source had them.
 */
export interface RawImportItem {
  name?: string | null;
  brand?: string | null;
  model?: string | null;
  serials?: string[] | string | null;
  category?: string | null;
  location?: string | null;
  quantity?: number | string | null;
  notes?: string | null;
  links?: string[] | string | null;
  labDocs?: (string | { title?: string | null; url?: string | null })[] | string | null;
  /** 1-based source row or line, for "row 14" in a message. */
  sourceRow?: number | null;
}

/** One validated item, ready to become a pending row (§3.2 "Validation"). */
export interface ImportItem {
  name: string;
  brand: string | null;
  categoryHint: string | null;
  locationHint: string | null;
  quantity: number;
  serials: string[];
  notes: string | null;
  links: ImportLink[];
  labDocs: LabDoc[];
  sourceRow: number | null;
}

/** A row that could not become an item, and why — shown beside the import's counts. */
export interface SkippedRow {
  sourceRow: number | null;
  reason: "no_name";
}
