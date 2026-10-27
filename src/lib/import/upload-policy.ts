import { extensionOf, isImportFileName } from "./detect.ts";
import { IMPORT_MAX_PDF_BYTES, IMPORT_MAX_TEXT_BYTES } from "./limits.ts";

/**
 * What an import upload may be (bulk intake spec §8; import progress spec
 * 2026-10-27 §3.5) — one rule for both doors: `POST /api/uploads` (the bytes
 * through the function) and `POST /api/uploads/token` (the browser straight to
 * Blob, for a file over the function's body limit).
 *
 * Pure and client-safe.
 */

/**
 * Text types a list may arrive as. Browsers label a CSV many ways (`text/csv`,
 * Excel's `application/vnd.ms-excel`, or nothing at all), so the file's
 * extension decides when its type is not a text type.
 */
export const IMPORT_TEXT_TYPES = new Set([
  "text/csv",
  "text/tab-separated-values",
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/csv",
  "application/vnd.ms-excel",
  // What a browser or a multipart round trip calls a file it has no type for
  // (a `.tsv`, often); the extension has already said it is a list.
  "application/octet-stream",
]);

export type ImportFileKind = "text" | "pdf";

/** What an import upload is — text or a PDF — or null when it is neither. */
export function importFileKind(type: string, name: string): ImportFileKind | null {
  const extension = extensionOf(name);
  if (type === "application/pdf") return "pdf";
  if (extension === "pdf") return type ? null : "pdf";
  if (!isImportFileName(name)) return null;
  if (!type || IMPORT_TEXT_TYPES.has(type) || type.startsWith("text/")) return "text";
  return null;
}

/** The largest file of this kind an import reads. */
export function importFileLimit(kind: ImportFileKind): number {
  return kind === "pdf" ? IMPORT_MAX_PDF_BYTES : IMPORT_MAX_TEXT_BYTES;
}

/**
 * The folder one person's direct uploads land in. The token is only issued
 * for a pathname under it, and completing an upload checks it again, so one
 * person can never claim another's file.
 */
export function importUploadPrefix(userId: string): string {
  return `uploads/import/${userId}/`;
}

/** The content type an import file is recorded as, so the reader needs no second guess. */
export function importStoredType(kind: ImportFileKind): string {
  return kind === "pdf" ? "application/pdf" : "text/plain";
}
