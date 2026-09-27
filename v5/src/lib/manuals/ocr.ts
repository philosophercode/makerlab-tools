import { classifyModelError, type ModelErrorKind } from "../ai/gateway-errors.ts";
import { modelIdFor } from "../ai/models.ts";
import type { ManualOutlineEntry } from "../db/schema/manuals.ts";
import { MAX_OUTLINE_ENTRIES, NO_TEXT_MIN_AVG_CHARS, type ExtractedManual, type ExtractedPage } from "./extract.ts";
import { renderPageImages, type RenderedPages } from "./page-images.ts";
import { transcribePage, type PageTranscript } from "./transcribe.ts";

/**
 * OCR for a scanned manual (manual text spec §9 phase 3): a PDF the extractor
 * classed `no_text` has its pages drawn as pictures (`page-images.ts`) and read
 * one by one by a vision model (`transcribe.ts`, job `ocr`), and comes out as
 * an ordinary `ready` document — every page at its own PDF page number, so a
 * passage from it cites `#page=N` like any other; each OCR'd page is stored
 * with `source = 'ocr'`.
 *
 * - **Bounded.** At most {@link OCR_MAX_PAGES} pages (the first ones) and about
 *   {@link OCR_MAX_COST_USD} dollars, by the Gateway's own reported cost, per
 *   manual — no new page is started once the budget is spent. A manual cut
 *   short is still stored (`status_reason = 'ocr_partial'`), the rest of its
 *   pages empty. Pages are read {@link OCR_CONCURRENCY} at a time.
 * - **The outline** is the headings the model marked, in page order
 *   (`outline_source = 'inferred'`), a heading repeated on consecutive pages
 *   kept once.
 * - **Failures.** A rate limit, a provider's bad minute or a timeout (after the
 *   SDK's own retries) stops the manual: nothing is stored and the next run
 *   tries again (`transient`). So does a configuration or auth failure, which
 *   no page would survive. A page the model refuses (an invalid request) is
 *   stored empty and the rest go on. A manual whose pages yield less text than
 *   a text PDF would need to be `ready` stays `no_text` — read, with nothing to
 *   show for it.
 * - **Only `npm run manuals:index` runs OCR** (see {@link OcrRunner}): it costs
 *   money per page and a long manual takes minutes on flex, which a workflow
 *   step for every uploaded scan should not.
 *
 * Logs nothing itself; returns counts, tokens and cost. Plain Node.
 */

/** Bump when what OCR stores changes (prompt, parsing): scans read by an older version are read again. */
export const OCR_VERSION = "ocr-1";

/** Pages read per manual, from the first. */
export const OCR_MAX_PAGES = 150;

/** Dollars per manual, by the Gateway's reported cost; no page starts past it. */
export const OCR_MAX_COST_USD = 1;

/** Pages read at once. */
export const OCR_CONCURRENCY = 4;

/** What `manual_documents.ocr_version` records: `ocr-1:openai/gpt-6-luna`. */
export function ocrKey(modelId: string = modelIdFor("ocr")): string {
  return `${OCR_VERSION}:${modelId}`;
}

export interface OcrStats {
  /** Pages sent to the model and answered. */
  pagesRead: number;
  /** Pages the model refused (stored empty). */
  pagesFailed: number;
  /** Pages with no picture on them (nothing to read). */
  pagesBlank: number;
  /** Pages past the page or cost cap, not read. */
  pagesSkipped: number;
  capped: "pages" | "cost" | null;
  inputTokens: number;
  outputTokens: number;
  /** Dollars the Gateway reported, summed; null when no call reported one. */
  cost: number | null;
  ms: number;
}

export type OcrManualResult =
  | ({ status: "read"; manual: ExtractedManual } & OcrStats)
  | ({
      status: "failed";
      reason: "unreadable" | "model";
      kind: ModelErrorKind | "unknown" | null;
      /** A retry (the next run) could succeed: nothing is recorded. */
      transient: boolean;
    } & OcrStats);

export interface OcrManualOptions {
  maxPages?: number;
  maxCost?: number;
  concurrency?: number;
  /** Reads one page; the deployment's `ocr` job by default. Tests pass their own. */
  transcribe?: (jpeg: Uint8Array, pageNumber: number) => Promise<PageTranscript>;
  /** Draws the pages; tests pass their own. */
  render?: (bytes: Uint8Array, options: { maxPages: number }) => Promise<RenderedPages>;
}

/**
 * What the index step is handed to OCR a scan: the key it records, and the
 * run. The workflow passes none — a scan stays `no_text` there — and the
 * backfill passes {@link defaultOcrRunner}.
 */
export interface OcrRunner {
  key: string;
  maxPages: number;
  run: (bytes: Uint8Array) => Promise<OcrManualResult>;
}

/** OCR with the deployment's `ocr` job and these caps. */
export function defaultOcrRunner(options: OcrManualOptions = {}): OcrRunner {
  return {
    key: ocrKey(),
    maxPages: options.maxPages ?? OCR_MAX_PAGES,
    run: (bytes) => ocrManual(bytes, options),
  };
}

/** Draw and read a scanned manual's pages. Never throws: every outcome is a value. */
export async function ocrManual(bytes: Uint8Array, options: OcrManualOptions = {}): Promise<OcrManualResult> {
  const started = Date.now();
  const maxPages = options.maxPages ?? OCR_MAX_PAGES;
  const maxCost = options.maxCost ?? OCR_MAX_COST_USD;
  const concurrency = Math.max(1, options.concurrency ?? OCR_CONCURRENCY);
  const transcribe = options.transcribe ?? ((jpeg: Uint8Array) => transcribePage(jpeg));
  const stats: OcrStats = {
    pagesRead: 0,
    pagesFailed: 0,
    pagesBlank: 0,
    pagesSkipped: 0,
    capped: null,
    inputTokens: 0,
    outputTokens: 0,
    cost: null,
    ms: 0,
  };

  let rendered: RenderedPages;
  try {
    rendered = await (options.render ?? renderPageImages)(bytes, { maxPages });
  } catch {
    return { status: "failed", reason: "unreadable", kind: null, transient: false, ...stats, ms: Date.now() - started };
  }
  if (rendered.pageCount > rendered.pages.length) {
    stats.capped = "pages";
    stats.pagesSkipped = rendered.pageCount - rendered.pages.length;
  }

  const transcripts = new Map<number, PageTranscript>();
  const run: { stop: { kind: ModelErrorKind | "unknown"; transient: boolean } | null } = { stop: null };
  let next = 0;
  const worker = async () => {
    while (!run.stop && next < rendered.pages.length) {
      const page = rendered.pages[next];
      next += 1;
      if (!page.jpeg) {
        stats.pagesBlank += 1;
        continue;
      }
      if ((stats.cost ?? 0) >= maxCost) {
        stats.capped = "cost";
        stats.pagesSkipped += 1;
        continue;
      }
      try {
        const transcript = await transcribe(page.jpeg, page.pageNumber);
        transcripts.set(page.pageNumber, transcript);
        stats.pagesRead += 1;
        stats.inputTokens += transcript.inputTokens;
        stats.outputTokens += transcript.outputTokens;
        if (transcript.cost !== null) stats.cost = (stats.cost ?? 0) + transcript.cost;
      } catch (error) {
        const failure = classify(error);
        if (failure.pageOnly) stats.pagesFailed += 1;
        else run.stop ??= failure;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, rendered.pages.length || 1) }, worker));
  stats.ms = Date.now() - started;

  const stop = run.stop;
  if (stop) return { status: "failed", reason: "model", kind: stop.kind, transient: stop.transient, ...stats };
  return { status: "read", manual: toManual(rendered, transcripts, stats), ...stats };
}

// ── The document ────────────────────────────────────────────────────

function toManual(rendered: RenderedPages, transcripts: Map<number, PageTranscript>, stats: OcrStats): ExtractedManual {
  const pages: ExtractedPage[] = [];
  const outline: ManualOutlineEntry[] = [];
  for (let n = 1; n <= rendered.pageCount; n += 1) {
    const transcript = transcripts.get(n);
    pages.push({ pageNumber: n, label: rendered.labels[n - 1] ?? null, text: transcript?.text ?? "", source: transcript ? "ocr" : "text" });
    for (const heading of transcript?.headings ?? []) {
      const last = outline[outline.length - 1];
      // A heading every page repeats is a running header, kept once.
      if (last && last.title.toLowerCase() === heading.title.toLowerCase() && last.level === heading.level) continue;
      if (outline.length < MAX_OUTLINE_ENTRIES) outline.push({ title: heading.title, page: n, level: heading.level });
    }
  }
  const chars = pages.reduce((sum, page) => sum + page.text.replace(/\s+/g, "").length, 0);
  const read = Math.max(1, stats.pagesRead);
  if (stats.pagesRead === 0 || chars / read < NO_TEXT_MIN_AVG_CHARS) {
    return {
      status: "no_text",
      reason: "no_text_layer",
      pageCount: rendered.pageCount,
      pages: [],
      outline: [],
      outlineSource: "none",
      title: null,
    };
  }
  return {
    status: "ready",
    reason: stats.capped ? "ocr_partial" : null,
    pageCount: rendered.pageCount,
    pages,
    outline,
    outlineSource: outline.length > 0 ? "inferred" : "none",
    title: null,
  };
}

// ── Failures ────────────────────────────────────────────────────────

const TRANSIENT: readonly ModelErrorKind[] = ["rate_limited", "provider_unavailable", "timeout"];

function classify(error: unknown): { kind: ModelErrorKind | "unknown"; transient: boolean; pageOnly: boolean } {
  const classified = classifyModelError(error);
  if (!classified) {
    const text = `${(error as { name?: string })?.name ?? ""} ${(error as { message?: string })?.message ?? ""}`;
    const network = /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|network|abort|timeout/i.test(text);
    return { kind: network ? "timeout" : "unknown", transient: network, pageOnly: false };
  }
  // The model would not read this page (a refused or malformed request): the page, not the run.
  if (classified.kind === "invalid_request") return { kind: classified.kind, transient: false, pageOnly: true };
  return { kind: classified.kind, transient: TRANSIENT.includes(classified.kind), pageOnly: false };
}
