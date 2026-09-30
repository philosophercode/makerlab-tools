/**
 * Backfill manual text and search passages: process every stored manual PDF
 * into pages and an outline (manual text spec §5 "Backfill", phase 1) — a
 * scanned one read by OCR (phase 3) — then chunk and embed every ready
 * document whose passages are missing or were built at another chunker
 * version or embedding model (phase 2).
 *
 *   npm run manuals:index -- [--dry-run] [--limit N] [--ids a,b,c] [--force] [--text-only]
 *                            [--no-ocr] [--force-ocr] [--ocr-max-pages N]
 *
 * New manuals are processed by the archive workflow right after they are
 * archived (`archiveManuals` → `indexManualStep`). Manuals archived or uploaded
 * before that have no `manual_documents` row; this processes them.
 *
 * - **Target** is the import scripts' order (`src/lib/import/target.ts`):
 *   `DATABASE_URL`, else `PGLITE_DATA_DIR` (stop the dev server first — the
 *   local database is single-process). Files are read back from Blob the way
 *   the workflow reads them (`manuals/stored-bytes.ts`): Vercel Blob with a
 *   token, `.blob-data/` in local development.
 * - **What is processed:** every *current* PDF of a resource — the archive's
 *   copy of its link, or a file somebody uploaded — that has no document at
 *   this `EXTRACTOR_VERSION` (`--force`: every one).
 * - **`--dry-run`** reads and extracts each PDF and reports what it would
 *   store, and writes nothing.
 * - **`--limit N`** stops after N PDFs; **`--ids`** takes resource ids,
 *   comma-separated.
 * - **Extraction costs nothing** (pdf.js in process). **Passages cost the
 *   embeddings**: job `embed` through the Gateway, ≤ 96 passages a call, about
 *   a fifth of a cent for a 200-page manual. Each document's line and the
 *   summary print the tokens and the Gateway-reported cost. `--text-only`
 *   skips this pass; `--dry-run` chunks and counts without embedding.
 * - Changing `MODEL_EMBED` or bumping `CHUNKER_VERSION` makes every document
 *   stale; this re-embeds them.
 * - **OCR** (phase 3, `manuals/ocr.ts`): a PDF that extracts as `no_text` (a
 *   scan) is drawn page by page and read by job `ocr` (Luna on flex) — at most
 *   `--ocr-max-pages` pages (default 150) and about $1 a manual, by the
 *   Gateway's reported cost. Scans stored earlier as `no_text` are taken up
 *   too. A scan already read by this OCR version is not read again, even
 *   under `--force` (it costs money); `--force-ocr` reads every scan again.
 *   `--no-ocr` (and `--text-only`) leave scans `no_text`; `--dry-run` says how
 *   many pages OCR would read and calls nothing.
 * - **Idempotent.** A second run with nothing new finds nothing to do: every
 *   PDF is at this extractor version, every scan read at this OCR version (or
 *   read and found empty), every ready document's passages current.
 *
 * Output: one line per PDF (status, pages, outline, OCR, time) and per
 * document (passages, tokens, cost), then totals and a closing summary —
 * manuals OCR'd, pages, passages, cost. Ids and counts only — no file names or
 * URLs.
 */
import { fileURLToPath } from "node:url";
import { listIndexablePdfs, type ResourcePdfForIndex } from "../src/lib/data/manual-documents.ts";
import { isUuid } from "../src/lib/data/uuid.ts";
import { PgliteLockedError } from "../src/lib/db/pglite-lock.ts";
import type { Db } from "../src/lib/db/types.ts";
import { listDocumentsNeedingPassages, type DocumentNeedingPassages } from "../src/lib/data/manual-chunks.ts";
import { CHUNKER_VERSION } from "../src/lib/manuals/chunk.ts";
import type { EmbeddingTarget } from "../src/lib/manuals/embed.ts";
import { EXTRACTOR_VERSION } from "../src/lib/manuals/extract.ts";
import { indexPdf, type IndexManualOptions, type IndexManualOutcome, type OcrSummary } from "../src/lib/manuals/index-document.ts";
import type { OcrRunner } from "../src/lib/manuals/ocr.ts";
import { buildDocumentPassages, describeCost, type PassagesOutcome } from "../src/lib/manuals/passages.ts";

// ── Arguments ───────────────────────────────────────────────────────

export interface IndexBackfillOptions {
  dryRun: boolean;
  force: boolean;
  limit: number | null;
  /** Resource ids; null for every resource with a PDF. */
  ids: string[] | null;
  /** Store text only; build no passages and read no scans (no Gateway call). */
  textOnly: boolean;
  /** Read scans (`no_text`) with OCR. Off with `--no-ocr` or `--text-only`. */
  ocr: boolean;
  /** Read every scan again, even one this OCR version already read. */
  forceOcr: boolean;
  /** Pages OCR reads per manual; null for the default (`OCR_MAX_PAGES`). */
  ocrMaxPages: number | null;
}

export function parseArgs(argv: readonly string[]): IndexBackfillOptions {
  const options: IndexBackfillOptions = {
    dryRun: false,
    force: false,
    limit: null,
    ids: null,
    textOnly: false,
    ocr: true,
    forceOcr: false,
    ocrMaxPages: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [flag, inline] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined];
    const value = () => {
      const next = inline ?? argv[++i];
      if (next === undefined) throw new Error(`${flag} needs a value.`);
      return next;
    };
    if (flag === "--dry-run") options.dryRun = true;
    else if (flag === "--text-only") options.textOnly = true;
    else if (flag === "--force") options.force = true;
    else if (flag === "--no-ocr") options.ocr = false;
    else if (flag === "--force-ocr") options.forceOcr = true;
    else if (flag === "--ocr-max-pages") {
      const n = Number(value());
      if (!Number.isInteger(n) || n < 1 || n > 1000) throw new Error("--ocr-max-pages must be a whole number from 1 to 1000.");
      options.ocrMaxPages = n;
    }
    else if (flag === "--limit") {
      const n = Number(value());
      if (!Number.isInteger(n) || n < 1) throw new Error("--limit must be a whole number of at least 1.");
      options.limit = n;
    } else if (flag === "--ids") {
      const ids = value()
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      if (ids.length === 0) throw new Error("--ids needs at least one resource id.");
      const bad = ids.find((id) => !isUuid(id));
      if (bad) throw new Error(`--ids takes resource ids (uuids); "${bad}" is not one.`);
      options.ids = ids;
    } else {
      throw new Error(
        `Unknown argument ${arg}. Use --dry-run, --force, --text-only, --limit N, --ids a,b,c, --no-ocr, --force-ocr, --ocr-max-pages N.`
      );
    }
  }
  if (options.textOnly) options.ocr = false;
  if (options.forceOcr && !options.ocr) throw new Error("--force-ocr cannot be used with --no-ocr or --text-only.");
  return options;
}

// ── The run ─────────────────────────────────────────────────────────

/**
 * The PDFs this run processes: those not at this extractor version and, when
 * OCR runs (`ocrKey`), the scans it has not read at that key.
 */
export function loadIndexTargets(
  db: Db,
  options: Pick<IndexBackfillOptions, "ids" | "limit" | "force"> & { forceOcr?: boolean },
  ocrKey?: string
) {
  return listIndexablePdfs(db, {
    resourceIds: options.ids ?? undefined,
    missingVersion: options.force ? undefined : EXTRACTOR_VERSION,
    ocrKey,
    forceOcr: options.forceOcr,
    limit: options.limit ?? undefined,
  });
}

/** What OCR came to over the run. */
export interface OcrReport {
  /** Scans read and stored `ready`. */
  manuals: number;
  /** Of those, cut short by the page or cost cap. */
  partial: number;
  /** Scans read and still `no_text` (nothing legible). */
  empty: number;
  /** Scans OCR could not read this run (next run tries again). */
  failed: number;
  /** Scans whose earlier OCR text was kept. */
  kept: number;
  pagesRead: number;
  pagesFailed: number;
  inputTokens: number;
  outputTokens: number;
  cost: number | null;
  /** Dry run: scans and pages OCR would read. */
  planned: number;
  plannedPages: number;
}

function emptyOcrReport(): OcrReport {
  return {
    manuals: 0,
    partial: 0,
    empty: 0,
    failed: 0,
    kept: 0,
    pagesRead: 0,
    pagesFailed: 0,
    inputTokens: 0,
    outputTokens: 0,
    cost: null,
    planned: 0,
    plannedPages: 0,
  };
}

export interface IndexBackfillReport {
  rows: { pdf: ResourcePdfForIndex; outcome: IndexManualOutcome }[];
  counts: { ready: number; no_text: number; failed: number; skipped: number; read_failed: number };
  pages: number;
  ocr: OcrReport;
  ms: number;
}

export interface RunIndexBackfillInput extends Pick<IndexManualOptions, "read" | "extract" | "ocr" | "forceOcr"> {
  db: Db;
  pdfs: readonly ResourcePdfForIndex[];
  dryRun: boolean;
  force?: boolean;
  log?: (line: string) => void;
}

/** One PDF at a time — pdf.js holds a whole file in memory — each reported as it finishes. A failure is counted and the run goes on. */
export async function runIndexBackfill(input: RunIndexBackfillInput): Promise<IndexBackfillReport> {
  const log = input.log ?? (() => {});
  const started = Date.now();
  const report: IndexBackfillReport = {
    rows: [],
    counts: { ready: 0, no_text: 0, failed: 0, skipped: 0, read_failed: 0 },
    pages: 0,
    ocr: emptyOcrReport(),
    ms: 0,
  };
  for (const [n, pdf] of input.pdfs.entries()) {
    let outcome: IndexManualOutcome;
    try {
      outcome = await indexPdf(pdf, {
        db: input.db,
        dryRun: input.dryRun,
        force: input.force,
        read: input.read,
        extract: input.extract,
        ocr: input.ocr,
        forceOcr: input.forceOcr,
        // Text only here: the passages pass (`runPassagesBackfill`) takes every
        // stale document afterwards, these included, and reports the cost once.
        passages: false,
      });
    } catch (error) {
      // The database write failed. Counted as a read failure: nothing was stored.
      log(`[${n + 1}/${input.pdfs.length}] resource ${pdf.resourceId}: error ${error instanceof Error ? error.message.split("\n")[0].slice(0, 160) : "unknown"}`);
      report.counts.read_failed += 1;
      continue;
    }
    report.rows.push({ pdf, outcome });
    if (outcome.status === "indexed") {
      report.counts[outcome.documentStatus] += 1;
      report.pages += outcome.pageCount ?? 0;
    } else if (outcome.status === "skipped") report.counts.skipped += 1;
    else report.counts.read_failed += 1;
    if (outcome.status === "skipped" && outcome.reason === "ocr_kept") report.ocr.kept += 1;
    if (outcome.status !== "failed" && outcome.ocr) addOcr(report.ocr, outcome.ocr);
    log(`[${n + 1}/${input.pdfs.length}] resource ${pdf.resourceId}: ${describe(outcome)}`);
  }
  report.ms = Date.now() - started;
  return report;
}

function addOcr(report: OcrReport, ocr: OcrSummary): void {
  if (ocr.status === "planned") {
    report.planned += 1;
    report.plannedPages += ocr.pages;
    return;
  }
  report.pagesRead += ocr.pagesRead;
  report.pagesFailed += ocr.pagesFailed;
  report.inputTokens += ocr.inputTokens;
  report.outputTokens += ocr.outputTokens;
  if (ocr.cost !== null) report.cost = (report.cost ?? 0) + ocr.cost;
  if (ocr.status === "failed") report.failed += 1;
  else if (ocr.documentStatus === "ready") {
    report.manuals += 1;
    if (ocr.capped) report.partial += 1;
  } else report.empty += 1;
}

/** `"; OCR 12 pages read, …"` — what OCR did for one PDF, or nothing. */
function describeOcr(ocr: OcrSummary | undefined): string {
  if (!ocr) return "";
  if (ocr.status === "planned") return `; OCR would read ${ocr.pages} page(s)`;
  const spend = `${ocr.inputTokens + ocr.outputTokens} tokens, ${describeCost(ocr.cost)}`;
  if (ocr.status === "failed") {
    return `; OCR failed (${ocr.reason === "unreadable" ? "pages could not be drawn" : (ocr.kind ?? "unknown")}` +
      `${ocr.transient ? ", transient — the next run tries again" : ""}) after ${ocr.pagesRead} page(s), ${spend}`;
  }
  const parts = [`${ocr.pagesRead} page(s) read`];
  if (ocr.pagesFailed) parts.push(`${ocr.pagesFailed} refused`);
  if (ocr.pagesBlank) parts.push(`${ocr.pagesBlank} blank`);
  if (ocr.capped) parts.push(`stopped at the ${ocr.capped === "pages" ? "page" : "cost"} cap, ${ocr.pagesSkipped} not read`);
  return `; OCR ${parts.join(", ")}, ${spend}, ${(ocr.ms / 1000).toFixed(1)}s`;
}

function describe(outcome: IndexManualOutcome): string {
  switch (outcome.status) {
    case "indexed":
      return (
        `${outcome.documentStatus}${outcome.reason ? ` (${outcome.reason})` : ""}, ${outcome.pageCount ?? 0} pages, ` +
        `${outcome.outlineEntries} outline entries, ${outcome.chars} chars, ${(outcome.ms / 1000).toFixed(1)}s` +
        describeOcr(outcome.ocr)
      );
    case "skipped":
      return `skipped (${outcome.reason === "ocr_kept" ? "scan, OCR text kept" : outcome.reason.replace(/_/g, " ")})${describeOcr(outcome.ocr)}`;
    case "failed":
      return `not read (${outcome.reason.replace(/_/g, " ")}${outcome.transient ? ", transient" : ""})`;
  }
}

export function summarise(report: IndexBackfillReport, dryRun: boolean): string {
  const c = report.counts;
  return (
    `${dryRun ? "Dry run — nothing written. " : ""}${c.ready + c.no_text + c.failed + c.read_failed} PDF(s) processed in ` +
    `${(report.ms / 1000).toFixed(1)}s: ready ${c.ready}, no_text ${c.no_text}, failed ${c.failed}` +
    `${c.read_failed ? `, not read ${c.read_failed}` : ""}${c.skipped ? `, skipped ${c.skipped}` : ""}; ${report.pages} pages.`
  );
}

/** One line for OCR over the run, or null when it had nothing to do. */
export function summariseOcr(ocr: OcrReport, dryRun: boolean): string | null {
  if (dryRun) {
    return ocr.planned > 0 ? `OCR (dry run, nothing read): ${ocr.planned} scan(s), up to ${ocr.plannedPages} page(s).` : null;
  }
  if (ocr.manuals + ocr.empty + ocr.failed + ocr.kept === 0) return null;
  const parts = [`${ocr.manuals} scan(s) read into text`];
  if (ocr.partial) parts.push(`${ocr.partial} cut short at a cap`);
  if (ocr.empty) parts.push(`${ocr.empty} with nothing legible`);
  if (ocr.failed) parts.push(`${ocr.failed} failed (the next run tries again)`);
  if (ocr.kept) parts.push(`${ocr.kept} kept from an earlier reading`);
  return (
    `OCR: ${parts.join(", ")}; ${ocr.pagesRead} page(s) read${ocr.pagesFailed ? `, ${ocr.pagesFailed} refused` : ""}, ` +
    `${ocr.inputTokens + ocr.outputTokens} tokens, ${describeCost(ocr.cost)}.`
  );
}

/** The closing summary: what the run left the library with, and what it cost. */
export function finalSummary(input: {
  text: IndexBackfillReport | null;
  passages: PassagesBackfillReport | null;
  dryRun: boolean;
}): string {
  const ocr = input.text?.ocr ?? emptyOcrReport();
  const c = input.text?.counts;
  const pdfs = c ? c.ready + c.no_text + c.failed + c.read_failed : 0;
  const costs = [ocr.cost, input.passages?.cost ?? null].filter((cost): cost is number => cost !== null);
  const total = costs.length ? costs.reduce((sum, cost) => sum + cost, 0) : null;
  return [
    `Summary${input.dryRun ? " (dry run — nothing written)" : ""}:`,
    `  PDFs processed:   ${pdfs}${c ? ` (ready ${c.ready}, no_text ${c.no_text}, failed ${c.failed})` : ""}`,
    `  Manuals OCR'd:    ${input.dryRun ? `${ocr.planned} would be` : ocr.manuals}${ocr.partial ? ` (${ocr.partial} partial)` : ""}`,
    `  Pages:            ${input.text?.pages ?? 0} ${input.dryRun ? "extracted" : "stored"}${input.dryRun ? `, ${ocr.plannedPages} to OCR` : `, ${ocr.pagesRead} read by OCR`}`,
    `  Passages:         ${input.passages?.passages ?? 0} ${input.dryRun ? "counted" : "built"} in ${(input.passages?.built ?? 0) + (input.passages?.chunked ?? 0)} document(s)`,
    `  Gateway cost:     ${total === null ? (input.dryRun ? "none (dry run)" : "none reported") : `$${total.toFixed(4)}`}`,
  ].join("\n");
}

// ── Passages (phase 2) ──────────────────────────────────────────────

/** The ready documents whose passages this run (re)builds. */
export function loadPassageTargets(
  db: Db,
  options: Pick<IndexBackfillOptions, "ids" | "limit" | "force">,
  embeddingModel: string
): Promise<DocumentNeedingPassages[]> {
  return listDocumentsNeedingPassages(
    db,
    { chunkerVersion: CHUNKER_VERSION, embeddingModel },
    { resourceIds: options.ids ?? undefined, limit: options.limit ?? undefined, force: options.force }
  );
}

export interface PassagesBackfillReport {
  built: number;
  /** Chunked, not embedded (dry run). */
  chunked: number;
  failed: number;
  skipped: number;
  passages: number;
  tokens: number;
  /** Dollars the Gateway reported, summed; null when no call reported one. */
  cost: number | null;
  ms: number;
}

export interface RunPassagesBackfillInput {
  db: Db;
  documents: readonly DocumentNeedingPassages[];
  dryRun: boolean;
  force?: boolean;
  /** The embedding model; the deployment's `embed` job by default. */
  target?: EmbeddingTarget;
  log?: (line: string) => void;
}

/**
 * Chunk and embed each document, one at a time, each reported as it finishes.
 * A dry run chunks and counts and calls nothing. A failure is counted and the
 * run goes on; a failed document keeps its text and is picked up next run.
 */
export async function runPassagesBackfill(input: RunPassagesBackfillInput): Promise<PassagesBackfillReport> {
  const log = input.log ?? (() => {});
  const started = Date.now();
  const report: PassagesBackfillReport = {
    built: 0,
    chunked: 0,
    failed: 0,
    skipped: 0,
    passages: 0,
    tokens: 0,
    cost: null,
    ms: 0,
  };
  for (const [n, doc] of input.documents.entries()) {
    const prefix = `[passages ${n + 1}/${input.documents.length}] resource ${doc.resourceId}:`;
    let outcome: PassagesOutcome;
    try {
      outcome = await buildDocumentPassages(input.db, doc.documentId, {
        dryRun: input.dryRun,
        force: input.force,
        target: input.target,
      });
    } catch (error) {
      log(`${prefix} error ${error instanceof Error ? error.message.split("\n")[0].slice(0, 160) : "unknown"}`);
      report.failed += 1;
      continue;
    }
    switch (outcome.status) {
      case "built":
        report.built += 1;
        report.passages += outcome.chunks;
        report.tokens += outcome.tokens;
        if (outcome.cost !== null) report.cost = (report.cost ?? 0) + outcome.cost;
        log(
          `${prefix} ${outcome.chunks} passages, ${outcome.tokens} tokens, ${outcome.calls} call(s), ` +
            `${describeCost(outcome.cost)}, ${(outcome.ms / 1000).toFixed(1)}s`
        );
        break;
      case "chunked":
        report.chunked += 1;
        report.passages += outcome.chunks;
        log(`${prefix} ${outcome.chunks} passages (dry run, not embedded)`);
        break;
      case "skipped":
        report.skipped += 1;
        log(`${prefix} skipped (${outcome.reason.replace(/_/g, " ")})`);
        break;
      case "failed":
        report.failed += 1;
        log(`${prefix} embedding failed (${outcome.kind}${outcome.transient ? ", transient" : ""})`);
        break;
    }
  }
  report.ms = Date.now() - started;
  return report;
}

export function summarisePassages(report: PassagesBackfillReport, dryRun: boolean): string {
  if (dryRun) {
    return `Passages (dry run, nothing embedded): ${report.chunked} document(s), ${report.passages} passages.`;
  }
  return (
    `Passages: ${report.built} document(s) built, ${report.passages} passages, ${report.tokens} tokens, ` +
    `${describeCost(report.cost)} in ${(report.ms / 1000).toFixed(1)}s` +
    `${report.failed ? `; ${report.failed} failed` : ""}${report.skipped ? `; ${report.skipped} skipped` : ""}.`
  );
}

// ── The command ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const { describeImportTarget, openImportTarget, resolveImportTarget } = await import("../src/lib/import/target.ts");
  const target = resolveImportTarget();
  console.log(`Target: ${describeImportTarget(target)}`);
  console.log(`Extractor: ${EXTRACTOR_VERSION}${options.dryRun ? " — dry run, nothing is written" : ""}`);
  let ocr: OcrRunner | undefined;
  if (options.ocr) {
    const { defaultOcrRunner, OCR_MAX_COST_USD } = await import("../src/lib/manuals/ocr.ts");
    ocr = defaultOcrRunner({ maxPages: options.ocrMaxPages ?? undefined });
    console.log(
      `OCR: ${ocr.key} (job \`ocr\`) for scans, up to ${ocr.maxPages} pages and ~$${OCR_MAX_COST_USD} a manual` +
        `${options.forceOcr ? " — every scan read again" : ""}`
    );
  } else {
    console.log("OCR: off — scans stay no_text.");
  }

  let opened;
  try {
    opened = await openImportTarget(target);
  } catch (error) {
    if (error instanceof PgliteLockedError) {
      console.error(`${error.message}\nStop the dev server (it holds the local database), then run this again.`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  // The per-PDF log lines from `indexPdf` repeat what this prints.
  const info = console.info;
  const warn = console.warn;
  console.info = () => {};
  console.warn = () => {};
  try {
    // 1. Text: PDFs with no document at this extractor version, and scans OCR has not read.
    const pdfs = await loadIndexTargets(opened.db, options, ocr?.key);
    let text: IndexBackfillReport | null = null;
    let passages: PassagesBackfillReport | null = null;
    const finish = () => console.log(`\n${finalSummary({ text, passages, dryRun: options.dryRun })}`);
    if (pdfs.length === 0) {
      console.log(
        options.force
          ? "No stored PDFs."
          : `Every stored PDF is already processed at ${EXTRACTOR_VERSION}${ocr ? ", every scan read" : ""}.`
      );
    } else {
      console.log(`${pdfs.length} PDF(s) to process. Extraction runs locally, at no cost${ocr ? "; OCR costs per page" : ""}.`);
      text = await runIndexBackfill({
        db: opened.db,
        pdfs,
        dryRun: options.dryRun,
        force: options.force,
        ocr,
        forceOcr: options.forceOcr,
        log: (line) => console.log(line),
      });
      console.log(summarise(text, options.dryRun));
      const ocrLine = summariseOcr(text.ocr, options.dryRun);
      if (ocrLine) console.log(ocrLine);
      if (text.counts.read_failed > 0 || text.ocr.failed > 0) process.exitCode = 1;
    }
    if (options.textOnly) {
      finish();
      return;
    }

    // 2. Passages: ready documents missing passages at this chunker and embedding model.
    const { embeddingModelKey } = await import("../src/lib/ai/models.ts");
    const embeddingModel = embeddingModelKey("embed");
    console.log(`Passages: ${CHUNKER_VERSION}, embeddings ${embeddingModel}${options.dryRun ? " — dry run, nothing is embedded" : ""}`);
    const documents = await loadPassageTargets(opened.db, options, embeddingModel);
    if (documents.length === 0) {
      console.log(options.dryRun && pdfs.length > 0
        ? "Dry run: the documents above were not written, so there are no passages to count."
        : "Every ready document already has current passages.");
      finish();
      return;
    }
    console.log(`${documents.length} document(s) to chunk and embed (Gateway job \`embed\`).`);
    passages = await runPassagesBackfill({
      db: opened.db,
      documents,
      dryRun: options.dryRun,
      force: options.force,
      log: (line) => console.log(line),
    });
    console.log(summarisePassages(passages, options.dryRun));
    if (passages.failed > 0) process.exitCode = 1;
    finish();
  } finally {
    console.info = info;
    console.warn = warn;
    await opened.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
