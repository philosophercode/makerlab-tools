import "server-only";

import { start } from "workflow/api";
import { findAttachmentsByIds } from "../data/attachments";
import {
  addImportItems,
  createBulkImport,
  failBulkImport,
  getBulkImport,
  setImportWorkflowRun,
  type BulkImportRecord,
} from "../data/bulk-imports";
import type { ImportSourceKind } from "../db/schema/vocabulary";
import type { Db } from "../db/types";
import { extractManual } from "../manuals/extract";
import { readStoredFile } from "../manuals/stored-bytes";
import { importDocument } from "../../workflows/import-document";
import { columnMapProblem, hasNameColumn, type ColumnMap, type ColumnMapProblem } from "./columns";
import { classifySource, extensionOf, isImportFileName } from "./detect";
import { chunkDocument } from "./extract-output";
import { normalizeImportItems, tableToRawItems } from "./items";
import { documentTooLong, IMPORT_MAX_ITEMS, IMPORT_MAX_PDF_BYTES, IMPORT_MAX_TEXT_BYTES } from "./limits";
import { parseLineList } from "./line-list";
import { buildTablePreview, readImportTable } from "./preview";
import { stripBom } from "./table";

/**
 * Starting an import and confirming its columns (bulk intake spec §3.1, §5) —
 * the one path `/admin/intake`'s **Import a list** (`POST /api/imports`), the
 * mapping step and the chat's `start_import` all take.
 *
 * 1. **The text.** From an uploaded file the caller made and nothing has
 *    claimed yet (`POST /api/uploads`, kind `import`: private Blob, the upload
 *    route's type and size checks) — a PDF's text extracted in memory — or from
 *    text sent directly. At most 5 MB of text, a 20 MB PDF. A document (prose
 *    or a PDF's text) longer than `IMPORT_DOCUMENT_MAX_CHARS` is refused as
 *    `document_too_long`, with its size in pages, before any model call —
 *    never cut to fit (amendment 2026-09-24). Over `IMPORT_MAX_ITEMS` rows is
 *    `too_many_items`, with the count.
 * 2. **The shape** (`detect.ts`): a table waits in `mapping` for its column
 *    matches — or, from the chat, takes the suggested ones when they name the
 *    name column; a plain list becomes rows at once; a document is `parsing`
 *    while `importDocument` reads it.
 * 3. **Rows** are made only by `addImportItems`: identified pending items, the
 *    duplicate check on each (inventory, waiting items, earlier rows).
 *
 * Refusals are codes the page and the chat word (`admin.import.errors.*`).
 * Nothing here researches or publishes (Article 5).
 */

export type StartImportError =
  | "empty"
  | "too_large"
  | "too_many_items"
  | "document_too_long"
  | "file_not_found"
  | "unsupported_file"
  | "unreadable_file"
  | "no_text_in_pdf"
  | "blob_unavailable";

export interface StartImportInput {
  userId: string;
  /** Text sent directly — a paste, or the chat's list. */
  text?: string | null;
  /** An `attachments.id` from `POST /api/uploads` (kind `import`). */
  attachmentId?: string | null;
  sourceName?: string | null;
  /** Where it came from: the intake page or the chat hand-off. */
  origin: "page" | "chat";
  /** Take the suggested column matches when they name a name column (the chat). */
  autoConfirm?: boolean;
  db?: Db;
  /** For tests: the document workflow's starter. */
  startRun?: (importId: string, chunkCount: number) => Promise<{ runId: string }>;
}

/**
 * A refusal carries the numbers its message needs: `too_many_items` the count
 * and the limit; `document_too_long` the size and the limit in pages (and the
 * limit in characters).
 */
export interface StartImportRefusal {
  ok: false;
  error: StartImportError;
  limit?: number;
  count?: number;
  pages?: number;
  limitPages?: number;
  limitChars?: number;
}

export type StartImportOutcome = { ok: true; import: BulkImportRecord } | StartImportRefusal;

export async function startImport(input: StartImportInput): Promise<StartImportOutcome> {
  const source = await resolveSource(input);
  if (!source.ok) return source;
  const { text, sourceName, sourceKind, attachmentId, isPdf } = source;
  if (!text.trim()) return { ok: false, error: "empty" };

  const shape = isPdf ? { format: "document" as const, delimiter: null } : classifySource(text, sourceName);
  const db = input.db;

  if (shape.format === "table") {
    const table = readImportTable(text, sourceName);
    if (!table || table.rows.length === 0) return { ok: false, error: "empty" };
    if (table.rows.length > IMPORT_MAX_ITEMS) return tooManyItems(table.rows.length);
    const created = await createBulkImport(
      { createdBy: input.userId, sourceKind, format: "table", sourceName, sourceText: text, sourceAttachmentId: attachmentId, status: "mapping" },
      { db }
    );
    if (input.autoConfirm) {
      const suggested = buildTablePreview(table).suggested;
      if (hasNameColumn(suggested)) await confirmImportMapping(created.id, suggested, { db });
    }
    return { ok: true, import: (await getBulkImport(created.id, { db })) ?? created };
  }

  if (shape.format === "list") {
    const { items } = normalizeImportItems(parseLineList(text));
    if (items.length > IMPORT_MAX_ITEMS) return tooManyItems(items.length);
    const created = await createBulkImport(
      { createdBy: input.userId, sourceKind, format: "list", sourceName, sourceText: text, sourceAttachmentId: attachmentId, status: "parsing" },
      { db }
    );
    await addImportItems(created.id, { items, rowCount: items.length }, { db });
    return { ok: true, import: (await getBulkImport(created.id, { db })) ?? created };
  }

  // Too long to read in one import: refused before any model call, never cut to fit.
  const tooLong = documentTooLong(text.length);
  if (tooLong) return { ok: false, error: "document_too_long", ...tooLong };

  const created = await createBulkImport(
    { createdBy: input.userId, sourceKind, format: "document", sourceName, sourceText: text, sourceAttachmentId: attachmentId, status: "parsing" },
    { db }
  );
  const { chunks } = chunkDocument(text);
  try {
    const run = input.startRun
      ? await input.startRun(created.id, chunks.length)
      : await start(importDocument, [created.id, chunks.length]);
    try {
      await setImportWorkflowRun(created.id, run.runId, { db });
    } catch (error) {
      console.error(`[import] run ${run.runId} started but its id was not stored:`, error);
    }
  } catch (error) {
    console.error(`[import] could not start reading import ${created.id}:`, error instanceof Error ? error.message : error);
    await failBulkImport(created.id, "start_failed", { db });
  }
  return { ok: true, import: (await getBulkImport(created.id, { db })) ?? created };
}

export type ConfirmMappingOutcome =
  | { ok: true; itemCount: number; duplicateCount: number }
  | { ok: false; error: ColumnMapProblem | "not_found" | "not_editable" | "too_many_items" };

/**
 * The mapping step's **Continue** (§5 step 1): the table is read again from the
 * import's own text, the map checked against it (a name column, each field
 * once, as wide as the table), and every row validated into a pending item.
 */
export async function confirmImportMapping(
  importId: string,
  map: ColumnMap,
  options: { db?: Db } = {}
): Promise<ConfirmMappingOutcome> {
  const found = await getBulkImport(importId, options);
  if (!found) return { ok: false, error: "not_found" };
  if (found.status !== "mapping" || found.format !== "table") return { ok: false, error: "not_editable" };
  const table = readImportTable(found.sourceText, found.sourceName);
  if (!table) return { ok: false, error: "not_editable" };
  const problem = columnMapProblem(map, table.headers.length);
  if (problem) return { ok: false, error: problem };

  const { items } = normalizeImportItems(tableToRawItems(table, map));
  if (items.length > IMPORT_MAX_ITEMS) return { ok: false, error: "too_many_items" };
  const written = await addImportItems(importId, { items, rowCount: table.rows.length, columnMap: map }, options);
  if (!written.ok) return { ok: false, error: written.reason };
  return { ok: true, itemCount: written.itemCount, duplicateCount: written.duplicateCount };
}

function tooManyItems(count: number): StartImportRefusal {
  return { ok: false, error: "too_many_items", count, limit: IMPORT_MAX_ITEMS };
}

// ── The source ──────────────────────────────────────────────────────

type ResolvedSource =
  | { ok: true; text: string; sourceName: string | null; sourceKind: ImportSourceKind; attachmentId: string | null; isPdf: boolean }
  | { ok: false; error: StartImportError };

async function resolveSource(input: StartImportInput): Promise<ResolvedSource> {
  const sourceName = input.sourceName?.trim().slice(0, 200) || null;
  if (input.attachmentId) {
    const [file] = await findAttachmentsByIds([input.attachmentId], { db: input.db });
    // Only the caller's own upload, not yet claimed by anything — an id typed
    // into a chat is not proof the caller made it (§8).
    if (!file || file.uploadedBy !== input.userId || file.ownerId !== null) return { ok: false, error: "file_not_found" };
    const name = sourceName ?? file.originalFilename ?? null;
    const isPdf = file.contentType === "application/pdf" || extensionOf(name) === "pdf";
    if (!isPdf && !isImportFileName(name) && !(file.contentType ?? "").startsWith("text/")) {
      return { ok: false, error: "unsupported_file" };
    }
    const limit = isPdf ? IMPORT_MAX_PDF_BYTES : IMPORT_MAX_TEXT_BYTES;
    const stored = await readStoredFile(file.blobPathname, file.access === "public" ? "public" : "private", limit);
    if (!stored.ok) {
      if (stored.reason === "too_large") return { ok: false, error: "too_large" };
      if (stored.reason === "not_configured") return { ok: false, error: "blob_unavailable" };
      return { ok: false, error: "file_not_found" };
    }
    let text: string;
    if (isPdf) {
      const extracted = await extractManual(stored.bytes, { maxBytes: IMPORT_MAX_PDF_BYTES });
      if (extracted.status === "failed") return { ok: false, error: "unreadable_file" };
      if (extracted.status !== "ready") return { ok: false, error: "no_text_in_pdf" };
      text = extracted.pages.map((page) => page.text).join("\n\n");
    } else {
      text = stripBom(new TextDecoder("utf-8").decode(stored.bytes));
    }
    return { ok: true, text, sourceName: name, sourceKind: kindFor(input.origin, name, isPdf), attachmentId: file.id, isPdf };
  }

  const text = stripBom(input.text ?? "");
  if (new TextEncoder().encode(text).byteLength > IMPORT_MAX_TEXT_BYTES) return { ok: false, error: "too_large" };
  return { ok: true, text, sourceName, sourceKind: input.origin === "chat" ? "chat" : "paste", attachmentId: null, isPdf: false };
}

function kindFor(origin: "page" | "chat", name: string | null, isPdf: boolean): ImportSourceKind {
  if (origin === "chat") return "chat";
  if (isPdf) return "document";
  const extension = extensionOf(name);
  if (extension === "csv") return "csv";
  if (extension === "tsv" || extension === "tab") return "tsv";
  return "document";
}
