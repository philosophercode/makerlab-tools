import { suggestColumnMap, looksLikeHeader, type ColumnMap } from "./columns.ts";
import { classifySource } from "./detect.ts";
import { IMPORT_PREVIEW_ROWS } from "./limits.ts";
import { parseTable, type ParsedTable } from "./table.ts";

/**
 * A table import as the mapping step shows it (bulk intake spec §5 step 1):
 * the headers, the first rows and the suggested matches. The server and the
 * browser read the same text the same way — {@link readImportTable} is what
 * confirming the mapping parses again.
 *
 * Pure and client-safe.
 */

export interface TablePreview {
  headers: string[];
  hasHeader: boolean;
  rows: string[][];
  rowCount: number;
  suggested: ColumnMap;
}

/** The whole table in an import's text, or null when the text is not a table. */
export function readImportTable(text: string, sourceName: string | null): ParsedTable | null {
  const shape = classifySource(text, sourceName);
  if (shape.format !== "table" || !shape.delimiter) return null;
  return parseTable(text, shape.delimiter, looksLikeHeader);
}

export function buildTablePreview(table: ParsedTable): TablePreview {
  const rows = table.rows.slice(0, IMPORT_PREVIEW_ROWS);
  return {
    headers: table.headers,
    hasHeader: table.hasHeader,
    rows,
    rowCount: table.rows.length,
    suggested: suggestColumnMap(table.headers, rows, table.hasHeader),
  };
}
