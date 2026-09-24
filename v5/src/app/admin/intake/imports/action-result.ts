import type { AdminGateError } from "../../../../lib/admin/action-result";
import type { ColumnMap, ColumnMapProblem } from "../../../../lib/import/columns";
import type { ImportItemView, ImportView } from "../../../../lib/import/view";

/**
 * The import page's action results and signatures (bulk intake spec §5, §6).
 * Apart from `actions.ts` because a `"use server"` module may export only
 * async functions, and the island needs these types.
 *
 * Refusals are codes, rendered from `admin.import.errors.<code>` (Article 6).
 */

export type ImportActionError =
  | AdminGateError
  | ColumnMapProblem
  | "invalid_field"
  | "not_found"
  | "not_editable"
  | "too_many_items"
  | "daily_limit"
  | "start_failed";

export type ImportActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: ImportActionError; remaining?: number };

/** What most row writes answer: the rows that changed, as the table shows them. */
export type RowsResult = ImportActionResult<{ items: ImportItemView[] }>;

export type LoadImportResult = ImportActionResult<{ import: ImportView; items: ImportItemView[] }>;

export interface RowPatch {
  name?: string;
  brand?: string | null;
  categoryHint?: string | null;
  locationHint?: string | null;
  quantity?: number;
  duplicateResolution?: "new_tool" | "add_unit" | "discard" | null;
}

/** The actions the page hands the island — passed as props, never imported by it. */
export interface ImportActions {
  load: (input: { importId: string }) => Promise<LoadImportResult>;
  confirmColumns: (input: { importId: string; columnMap: ColumnMap }) => Promise<LoadImportResult>;
  updateRow: (input: { importId: string; id: string; patch: RowPatch }) => Promise<RowsResult>;
  setHints: (input: { importId: string; ids: string[]; categoryHint?: string | null; locationHint?: string | null }) => Promise<RowsResult>;
  removeRows: (input: { importId: string; ids: string[] }) => Promise<RowsResult>;
  mergeRow: (input: { importId: string; sourceId: string; targetId: string }) => Promise<RowsResult>;
  acceptSuggestions: (input: { importId: string; ids: string[] }) => Promise<RowsResult>;
  ignoreSuggestions: (input: { importId: string; ids: string[] }) => Promise<RowsResult>;
  suggestNames: (input: { importId: string; ids: string[] }) => Promise<ImportActionResult<{ requested: number }>>;
}
