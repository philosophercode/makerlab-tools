import { getDb } from "../db/client.ts";
import type { ManualDocumentStatus } from "../db/schema/vocabulary.ts";
import type { Db } from "../db/types.ts";
import {
  listCurrentPdfsForResource,
  saveManualDocument,
  type ResourcePdfForIndex,
} from "../data/manual-documents.ts";
import { isUuid } from "../data/uuid.ts";
import { EXTRACTOR_VERSION, extractManual, MANUAL_EXTRACT_MAX_BYTES, type ExtractedManual } from "./extract.ts";
import { buildDocumentPassages, type PassagesOptions, type PassagesOutcome } from "./passages.ts";
import { readStoredFile, type StoredFileResult } from "./stored-bytes.ts";

/**
 * Processing a stored manual PDF into text (manual text spec §3.1, phase 1):
 * read the bytes back from Blob, extract (`extract.ts`), and write the
 * document and its pages in one transaction (`data/manual-documents.ts`).
 *
 * - **Per resource.** {@link indexResourceManuals} processes each *current*
 *   PDF of a resource — the manual archive's copy of its link, or a file staff
 *   uploaded — so the one call after archiving covers both (§3.1 "Staff-uploaded
 *   PDF resources call the same step").
 * - **Idempotent** on the attachment id and {@link EXTRACTOR_VERSION}: a PDF
 *   already processed by this version is `skipped`; an older version is
 *   re-processed in place.
 * - **Outcomes are values.** `no_text` and `failed` (encrypted, corrupt, too
 *   large) are *stored* results — a scan stays a scan however often it is
 *   read, so they are never retried. The only failure a retry could fix is the
 *   Blob read itself (`transient`); the database throws, and the step
 *   classifies that.
 *
 * - **Then its passages** (phase 2, `passages.ts`): a `ready` document — just
 *   extracted, or extracted before and skipped — is chunked and embedded when
 *   its passages are missing or were built at another chunker or embedding
 *   version. The outcome rides on `passages`; an embedding failure never
 *   undoes the stored text, and the step decides whether to retry it.
 *
 * Logs ids, counts and outcomes only. Plain Node: relative imports, no
 * `"server-only"` — the workflow step and the backfill both run it.
 */

export type IndexManualOutcome =
  | {
      status: "indexed";
      attachmentId: string;
      documentStatus: ManualDocumentStatus;
      reason: string | null;
      pageCount: number | null;
      outlineEntries: number;
      chars: number;
      ms: number;
      /** The passages step, for a ready document (absent in a dry run or when not asked for). */
      passages?: PassagesOutcome;
    }
  | { status: "skipped"; attachmentId: string; reason: "already_indexed"; passages?: PassagesOutcome }
  | { status: "failed"; attachmentId: string; reason: "read_failed" | "blob_not_configured"; transient: boolean };

export interface IndexManualOptions {
  db?: Db;
  /** Re-process even when this version already did (the backfill's `--force`). */
  force?: boolean;
  /** Read and extract, but write nothing (the backfill's `--dry-run`). */
  dryRun?: boolean;
  /** The Blob read; tests pass their own. */
  read?: (pathname: string, access: "public" | "private", maxBytes: number) => Promise<StoredFileResult>;
  /** The extractor; tests pass their own. */
  extract?: (bytes: Uint8Array) => Promise<ExtractedManual>;
  /**
   * How the passages step runs (its embedding target, `force`), or `false` to
   * store text only. Default: build passages with the deployment's `embed` job.
   */
  passages?: PassagesOptions | false;
}

/** Process every current PDF of `resourceId`. Empty when it has none (or is not a uuid). */
export async function indexResourceManuals(
  resourceId: string,
  options: IndexManualOptions = {}
): Promise<IndexManualOutcome[]> {
  if (!isUuid(resourceId)) return [];
  const db = options.db ?? (await getDb());
  const pdfs = await listCurrentPdfsForResource(db, resourceId);
  const outcomes: IndexManualOutcome[] = [];
  for (const pdf of pdfs) outcomes.push(await indexPdf(pdf, { ...options, db }));
  return outcomes;
}

/** Process one current PDF. */
export async function indexPdf(
  pdf: ResourcePdfForIndex,
  options: IndexManualOptions & { db: Db }
): Promise<IndexManualOutcome> {
  if (!options.force && pdf.documentVersion === EXTRACTOR_VERSION) {
    const passages =
      pdf.documentId && pdf.documentStatus === "ready" && !options.dryRun
        ? await passagesFor(pdf.documentId, options)
        : undefined;
    return {
      status: "skipped",
      attachmentId: pdf.attachmentId,
      reason: "already_indexed",
      ...(passages ? { passages } : {}),
    };
  }

  const started = Date.now();
  const read = options.read ?? readStoredFile;
  const access = pdf.access === "private" ? "private" : "public";
  const stored = await read(pdf.blobPathname, access, MANUAL_EXTRACT_MAX_BYTES);

  let extracted: ExtractedManual;
  if (stored.ok) {
    extracted = await (options.extract ?? extractManual)(stored.bytes);
  } else if (stored.reason === "too_large") {
    // Over the limit is an answer about the file, not about the store: record it.
    extracted = {
      status: "failed",
      reason: "too_large",
      pageCount: null,
      pages: [],
      outline: [],
      outlineSource: null,
      title: null,
    };
  } else {
    const outcome: IndexManualOutcome = {
      status: "failed",
      attachmentId: pdf.attachmentId,
      reason: stored.reason === "not_configured" ? "blob_not_configured" : "read_failed",
      transient: stored.transient,
    };
    console.warn(
      `[manuals] index failed: attachment=${pdf.attachmentId} reason=${outcome.reason}${stored.reason === "missing" ? " (missing)" : ""}`
    );
    return outcome;
  }

  let documentId: string | null = null;
  if (!options.dryRun) documentId = await saveManualDocument(options.db, {
    attachmentId: pdf.attachmentId,
    toolId: pdf.toolId,
    title: documentTitle(pdf, extracted),
    status: extracted.status,
    statusReason: extracted.reason,
    pageCount: extracted.pageCount,
    outline: extracted.outline,
    outlineSource: extracted.outlineSource,
    extractorVersion: EXTRACTOR_VERSION,
    pages: extracted.pages,
  });
  const passages = documentId && extracted.status === "ready" ? await passagesFor(documentId, options) : undefined;

  const chars = extracted.pages.reduce((sum, page) => sum + page.text.length, 0);
  const ms = Date.now() - started;
  console.info(
    `[manuals] ${options.dryRun ? "extracted (dry run)" : "indexed"}: attachment=${pdf.attachmentId} status=${extracted.status}` +
      `${extracted.reason ? ` reason=${extracted.reason}` : ""} pages=${extracted.pageCount ?? 0}` +
      ` outline=${extracted.outlineSource ?? "none"}:${extracted.outline.length} ms=${ms}`
  );
  return {
    status: "indexed",
    attachmentId: pdf.attachmentId,
    documentStatus: extracted.status,
    reason: extracted.reason,
    pageCount: extracted.pageCount,
    outlineEntries: extracted.outline.length,
    chars,
    ms,
    ...(passages ? { passages } : {}),
  };
}

/** The passages step for a stored document, unless the caller asked for text only. */
async function passagesFor(
  documentId: string,
  options: IndexManualOptions & { db: Db }
): Promise<PassagesOutcome | undefined> {
  if (options.passages === false) return undefined;
  return buildDocumentPassages(options.db, documentId, {
    ...options.passages,
    force: options.passages?.force ?? options.force,
  });
}

/** The resource's title (what the lab calls it), else the PDF's own, else the file name. */
function documentTitle(pdf: ResourcePdfForIndex, extracted: ExtractedManual): string {
  return (pdf.resourceTitle.trim() || extracted.title || pdf.originalFilename || "Manual").slice(0, 300);
}
