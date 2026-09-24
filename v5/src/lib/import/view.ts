import type { BulkImportRecord, BulkImportSummary } from "../data/bulk-imports";
import type { PendingTool } from "../data/pending-tools";
import type { ImportFormat, ImportSourceKind, ImportStatus } from "../db/schema/vocabulary";
import type { PendingToolView } from "../intake/types";
import { toPendingToolView } from "../intake/view";
import type { ImportLink, LabDoc, NameSuggestion } from "./types";

/**
 * Bulk intake as a browser sees it (bulk intake spec §6). Client-safe: every
 * data import is type-only. Like `PendingToolView`, no id that names a person
 * and never the import's source text.
 */

export interface ImportView {
  id: string;
  status: ImportStatus;
  format: ImportFormat;
  sourceKind: ImportSourceKind;
  sourceName: string | null;
  parseError: string | null;
  rowCount: number;
  itemCount: number;
  duplicateCount: number;
  createdByName: string | null;
  createdAt: string;
}

/** A pending row of an import, with what the review table shows beyond the chat's card. */
export interface ImportItemView extends PendingToolView {
  sourceRow: number | null;
  quantity: number;
  serials: string[];
  labDocs: LabDoc[];
  links: ImportLink[];
  notes: string | null;
  nameSuggestion: NameSuggestion | null;
}

/** The `data-import-card` stream part `start_import` writes (§3.5). */
export interface ImportCardPayload {
  kind: "import-card";
  import: ImportView;
  /** Where the Review button goes. */
  href: string;
}

export function importPath(id: string): string {
  return `/admin/intake/imports/${id}`;
}

export function toImportView(record: BulkImportRecord | BulkImportSummary, createdByName: string | null = null): ImportView {
  return {
    id: record.id,
    status: record.status,
    format: record.format,
    sourceKind: record.sourceKind,
    sourceName: record.sourceName,
    parseError: record.parseError,
    rowCount: record.rowCount,
    itemCount: record.itemCount,
    duplicateCount: record.duplicateCount,
    createdByName: "createdByName" in record ? record.createdByName : createdByName,
    createdAt: record.createdAt.toISOString(),
  };
}

export function toImportItemView(item: PendingTool): ImportItemView {
  return {
    ...toPendingToolView(item),
    sourceRow: item.sourceRow,
    quantity: item.quantity,
    serials: item.serials,
    labDocs: item.labDocs,
    links: item.links,
    notes: item.notes,
    nameSuggestion: item.nameSuggestion,
  };
}
