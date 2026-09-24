import type { ImportFormat } from "../db/schema/vocabulary.ts";
import { looksLikeHeader } from "./columns.ts";
import { isPlainList } from "./line-list.ts";
import { detectDelimiter, parseDelimited, type Delimiter } from "./table.ts";

/**
 * How an import's text is read (bulk intake spec §3.2): a table, a plain list,
 * or a document for the model.
 *
 * - A `.csv` / `.tsv` file is a table, whatever else it looks like.
 * - A `.pdf` is a document.
 * - Anything else — a paste, a `.txt`, a `.md`, text from the chat — is a
 *   table when it is tab-separated (spreadsheet cells) or when its first row is
 *   a recognisable header ("Item, Qty, Location"); a plain list when its lines
 *   are short entries; otherwise a document. A comma-separated list with no
 *   header ("Prusa MK4, 3 units") is **not** a table: commas in a line are
 *   ordinary punctuation until a header says otherwise.
 *
 * Pure and client-safe.
 */

export interface SourceShape {
  format: ImportFormat;
  /** Set when `format` is `table`. */
  delimiter: Delimiter | null;
}

export function classifySource(text: string, fileName?: string | null): SourceShape {
  const extension = extensionOf(fileName);
  if (extension === "pdf") return { format: "document", delimiter: null };
  if (extension === "csv") return { format: "table", delimiter: detectDelimiter(text) ?? "," };
  if (extension === "tsv" || extension === "tab") return { format: "table", delimiter: "\t" };

  const delimiter = detectDelimiter(text);
  if (delimiter === "\t") return { format: "table", delimiter };
  if (delimiter) {
    const first = parseDelimited(text, delimiter)[0] ?? [];
    if (looksLikeHeader(first)) return { format: "table", delimiter };
  }
  return { format: isPlainList(text) ? "list" : "document", delimiter: null };
}

/** `"Inventory.CSV"` → `"csv"`; null for no name or no extension. */
export function extensionOf(fileName: string | null | undefined): string | null {
  const match = (fileName ?? "").trim().toLowerCase().match(/\.([a-z0-9]{1,5})$/);
  return match ? match[1] : null;
}

/** File extensions an import accepts — the upload's `accept` and the route's check. */
export const IMPORT_FILE_EXTENSIONS = ["csv", "tsv", "tab", "txt", "md", "markdown", "pdf"] as const;

/** Whether a file name has an extension an import reads. */
export function isImportFileName(fileName: string | null | undefined): boolean {
  const extension = extensionOf(fileName);
  return extension !== null && (IMPORT_FILE_EXTENSIONS as readonly string[]).includes(extension);
}
