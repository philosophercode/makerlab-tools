import type { ColumnMap } from "./columns.ts";
import { normalizeImportItems, tableToRawItems } from "./items.ts";
import { parseLineList } from "./line-list.ts";
import { readImportTable } from "./preview.ts";
import { stripBom } from "./table.ts";
import type { ImportItem, SkippedRow } from "./types.ts";

/**
 * An import's rows, read again from its own text (import progress spec
 * 2026-10-27 §3.2): what the background writer slices, and what the page shows
 * as the raw list beside the review table. The same text read the same way
 * every time, so a step that runs again finds the same items in the same order
 * — which is what lets `progress.done` say where to resume.
 *
 * Pure and plain Node: no `"server-only"`, relative imports.
 */

/** What the rows are read from — the fields of an import record this needs. */
export interface ImportSource {
  format: "table" | "list" | "document";
  sourceText: string;
  sourceName: string | null;
  columnMap: ColumnMap | null;
}

export interface ImportRowsRead {
  items: ImportItem[];
  skipped: SkippedRow[];
  rowCount: number;
}

/**
 * A table through its confirmed column map, or a plain list line by line.
 * Null for a document (its items come from the model, not the text) or a
 * table whose map is not confirmed yet.
 */
export function readImportRows(source: ImportSource, map: ColumnMap | null = source.columnMap): ImportRowsRead | null {
  if (source.format === "table") {
    if (!map) return null;
    const table = readImportTable(source.sourceText, source.sourceName);
    if (!table) return null;
    const { items, skipped } = normalizeImportItems(tableToRawItems(table, map));
    return { items, skipped, rowCount: table.rows.length };
  }
  if (source.format === "list") {
    const { items, skipped } = normalizeImportItems(parseLineList(source.sourceText));
    return { items, skipped, rowCount: items.length + skipped.length };
  }
  return null;
}

/** One line of the source as it was sent, numbered as the items' `sourceRow`. */
export interface SourceRow {
  row: number;
  cells: string[];
}

export interface SourceRowsView {
  /** The table's header cells, or null for a list or a headerless table. */
  headers: string[] | null;
  rows: SourceRow[];
  /** Rows not sent because the list is longer than the page shows. */
  hidden: number;
}

/** Raw rows the page shows at most — the review table covers the rest. */
export const SOURCE_ROWS_SHOWN = 1000;

/** Characters of one cell shown; a cell is a glance, not the record. */
const CELL_MAX = 160;

/**
 * The source as the page shows it while rows are written: a table's rows and
 * header, a list's non-empty lines. Null for a document, which has no rows to
 * show until the model has read it.
 */
export function sourceRowsView(source: Pick<ImportSource, "format" | "sourceText" | "sourceName">): SourceRowsView | null {
  if (source.format === "table") {
    const table = readImportTable(source.sourceText, source.sourceName);
    if (!table) return null;
    const rows = table.rows.map((cells, index) => ({ row: table.rowNumbers[index] ?? index + 1, cells: cells.map(clip) }));
    return {
      headers: table.hasHeader ? table.headers.map(clip) : null,
      rows: rows.slice(0, SOURCE_ROWS_SHOWN),
      hidden: Math.max(0, rows.length - SOURCE_ROWS_SHOWN),
    };
  }
  if (source.format === "list") {
    const rows: SourceRow[] = [];
    stripBom(source.sourceText)
      .split(/\r\n|\r|\n/)
      .forEach((line, index) => {
        if (line.trim()) rows.push({ row: index + 1, cells: [clip(line.trim())] });
      });
    return { headers: null, rows: rows.slice(0, SOURCE_ROWS_SHOWN), hidden: Math.max(0, rows.length - SOURCE_ROWS_SHOWN) };
  }
  return null;
}

function clip(value: string): string {
  return value.length > CELL_MAX ? `${value.slice(0, CELL_MAX - 1)}…` : value;
}
