import { getDb } from "../db/client.ts";
import type { ManualDocumentStatus } from "../db/schema/vocabulary.ts";
import type { Db } from "../db/types.ts";
import {
  listCurrentPdfsForResource,
  markScanReExtracted,
  saveManualDocument,
  type ResourcePdfForIndex,
} from "../data/manual-documents.ts";
import { isUuid } from "../data/uuid.ts";
import { EXTRACTOR_VERSION, extractManual, MANUAL_EXTRACT_MAX_BYTES, type ExtractedManual } from "./extract.ts";
import type { OcrManualResult, OcrRunner, OcrStats } from "./ocr.ts";
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
 * - **OCR for a scan** (phase 3, `ocr.ts`), only when the caller hands an
 *   {@link OcrRunner} — the backfill does, the workflow does not. A PDF that
 *   extracts as `no_text` is read page by page and stored `ready` with its
 *   pages marked `ocr` and `ocr_version` set; a scan OCR could not read this
 *   run (the model's bad minute) is stored `no_text` without `ocr_version`, so
 *   the next run tries again. **OCR text is kept** when the same scan is
 *   extracted again without OCR (the workflow's Re-process) or by the same OCR
 *   version (`--force` without `--force-ocr`): extraction would only say
 *   "scan" again, and reading it costs money.
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
      /** OCR of a scan, when it ran (or, in a dry run, would have). */
      ocr?: OcrSummary;
    }
  | {
      status: "skipped";
      attachmentId: string;
      /** `ocr_kept`: a scan whose OCR text stands (see above). */
      reason: "already_indexed" | "ocr_kept";
      passages?: PassagesOutcome;
      ocr?: OcrSummary;
    }
  | { status: "failed"; attachmentId: string; reason: "read_failed" | "blob_not_configured"; transient: boolean };

/** What OCR did for one scan. */
export type OcrSummary =
  | ({ status: "read"; key: string; documentStatus: ManualDocumentStatus } & OcrStats)
  | ({ status: "failed"; reason: "unreadable" | "model"; kind: string | null; transient: boolean } & OcrStats)
  /** A dry run: what OCR would read, and nothing called. */
  | { status: "planned"; pages: number };

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
  /** OCR for scans (`ocr.ts`); absent, a scan is stored `no_text` (the workflow). */
  ocr?: OcrRunner;
  /** Read scans again even when this OCR version already did (the backfill's `--force-ocr`). */
  forceOcr?: boolean;
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
  if (!options.force && pdf.documentVersion === EXTRACTOR_VERSION && !wantsOcr(pdf, options)) {
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

  let ocr: OcrSummary | undefined;
  let ocrVersion: string | null = null;
  if (stored.ok && extracted.status === "no_text") {
    // A scan. Its OCR text stands when nobody asked for a new reading.
    if (keepsOcrText(pdf, options)) {
      if (!options.dryRun) await markScanReExtracted(options.db, pdf.documentId!, EXTRACTOR_VERSION);
      const passages = !options.dryRun ? await passagesFor(pdf.documentId!, options) : undefined;
      return { status: "skipped", attachmentId: pdf.attachmentId, reason: "ocr_kept", ...(passages ? { passages } : {}) };
    }
    if (options.ocr && options.dryRun) {
      ocr = { status: "planned", pages: Math.min(extracted.pageCount ?? 0, options.ocr.maxPages) };
    } else if (options.ocr) {
      const result = await options.ocr.run(stored.bytes);
      ocr = summarise(result, options.ocr.key);
      if (result.status === "read") {
        extracted = result.manual;
        ocrVersion = options.ocr.key;
      } else if (pdf.documentOcrVersion !== null && pdf.documentStatus === "ready") {
        // A new reading failed: the one stored before stands.
        await markScanReExtracted(options.db, pdf.documentId!, EXTRACTOR_VERSION);
        return { status: "skipped", attachmentId: pdf.attachmentId, reason: "ocr_kept", ocr };
      }
    }
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
    ocrVersion,
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
    ...(ocr ? { ocr } : {}),
  };
}

/** Whether this PDF is a scan the caller's OCR should (re)read. */
function wantsOcr(pdf: ResourcePdfForIndex, options: IndexManualOptions): boolean {
  if (!options.ocr) return false;
  const isScan = pdf.documentStatus === "no_text" || pdf.documentOcrVersion !== null;
  return isScan && (options.forceOcr === true || pdf.documentOcrVersion !== options.ocr.key);
}

/** Whether a scan's stored OCR text stands: no OCR asked for, or the same OCR and no `forceOcr`. */
function keepsOcrText(pdf: ResourcePdfForIndex, options: IndexManualOptions): boolean {
  if (pdf.documentId === null || pdf.documentStatus !== "ready" || pdf.documentOcrVersion === null) return false;
  if (!options.ocr) return true;
  return pdf.documentOcrVersion === options.ocr.key && !options.forceOcr;
}

function summarise(result: OcrManualResult, key: string): OcrSummary {
  if (result.status === "read") {
    const { manual, ...stats } = result;
    return { ...stats, status: "read", key, documentStatus: manual.status };
  }
  return result;
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
