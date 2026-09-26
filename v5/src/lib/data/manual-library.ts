/**
 * The Manuals page's vocabulary (public polish), client-safe: no database
 * import, so the page's table can use it. `listManualLibrary` in
 * `./manual-chunks.ts` fills it.
 */

/** A manual's state as the library names it: the five buckets `countManualsByState` counts. */
export type ManualLibraryState = "searchable" | "textOnly" | "noText" | "failed" | "processing";

export const MANUAL_LIBRARY_STATES: readonly ManualLibraryState[] = ["searchable", "textOnly", "noText", "failed", "processing"];

/** One current manual PDF, with the tool it belongs to and what is stored for it. */
export interface ManualLibraryRow {
  /** The attachment — one row per current PDF. */
  id: string;
  resourceId: string;
  title: string;
  toolId: string | null;
  toolName: string | null;
  toolSlug: string | null;
  state: ManualLibraryState;
  pageCount: number | null;
  passages: number;
  /** A failed document's stored reason (`encrypted`, `corrupt`, `too_large`). */
  reason: string | null;
  processedAt: Date | null;
}
