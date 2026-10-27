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

/**
 * A row that could not become an item, and why — shown beside the import's
 * counts. `placeholder_name`: the row's name says nothing about which item it
 * is ("Unknown", "TBD", "Item" — data platform spec amendment "No empty items").
 */
export interface SkippedRow {
  sourceRow: number | null;
  reason: "no_name" | "placeholder_name";
}

/**
 * How far an import's rows are written, and a document read
 * (`bulk_imports.progress`, import progress spec 2026-10-27 §4). Every field is
 * optional: an import finished before progress was kept has `{}`.
 */
export interface ImportProgress {
  /** Items to write. */
  total?: number;
  /** Items handled so far — written, or merged into nothing. */
  done?: number;
  /** The last source row a slice committed; a restarted run starts after it. */
  lastRow?: number;
  /** A document's parts, and how many have been read. */
  chunks?: number;
  chunksDone?: number;
  /** Rows that made no item, and why — so nothing drops silently. */
  skipped?: SkippedRow[];
  /** ISO time the rows started being written. */
  startedAt?: string;
}
