/**
 * Backfill manual text: process every stored manual PDF into pages and an
 * outline (manual text spec §5 "Backfill", phase 1).
 *
 *   npm run manuals:index -- [--dry-run] [--limit N] [--ids a,b,c] [--force]
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
 * - **No Gateway call and no cost** in phase 1: extraction is pdf.js in
 *   process. Phase 2 adds embeddings, and with them a cost line.
 *
 * Output: one line per PDF (status, pages, outline, time), then totals by
 * status, pages and wall time. Ids and counts only — no file names or URLs.
 */
import { fileURLToPath } from "node:url";
import { listIndexablePdfs, type ResourcePdfForIndex } from "../src/lib/data/manual-documents.ts";
import { isUuid } from "../src/lib/data/uuid.ts";
import { PgliteLockedError } from "../src/lib/db/pglite-lock.ts";
import type { Db } from "../src/lib/db/types.ts";
import { EXTRACTOR_VERSION } from "../src/lib/manuals/extract.ts";
import { indexPdf, type IndexManualOptions, type IndexManualOutcome } from "../src/lib/manuals/index-document.ts";

// ── Arguments ───────────────────────────────────────────────────────

export interface IndexBackfillOptions {
  dryRun: boolean;
  force: boolean;
  limit: number | null;
  /** Resource ids; null for every resource with a PDF. */
  ids: string[] | null;
}

export function parseArgs(argv: readonly string[]): IndexBackfillOptions {
  const options: IndexBackfillOptions = { dryRun: false, force: false, limit: null, ids: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [flag, inline] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined];
    const value = () => {
      const next = inline ?? argv[++i];
      if (next === undefined) throw new Error(`${flag} needs a value.`);
      return next;
    };
    if (flag === "--dry-run") options.dryRun = true;
    else if (flag === "--force") options.force = true;
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
      throw new Error(`Unknown argument ${arg}. Use --dry-run, --force, --limit N, --ids a,b,c.`);
    }
  }
  return options;
}

// ── The run ─────────────────────────────────────────────────────────

/** The PDFs this run processes. */
export function loadIndexTargets(db: Db, options: Pick<IndexBackfillOptions, "ids" | "limit" | "force">) {
  return listIndexablePdfs(db, {
    resourceIds: options.ids ?? undefined,
    missingVersion: options.force ? undefined : EXTRACTOR_VERSION,
    limit: options.limit ?? undefined,
  });
}

export interface IndexBackfillReport {
  rows: { pdf: ResourcePdfForIndex; outcome: IndexManualOutcome }[];
  counts: { ready: number; no_text: number; failed: number; skipped: number; read_failed: number };
  pages: number;
  ms: number;
}

export interface RunIndexBackfillInput extends Pick<IndexManualOptions, "read" | "extract"> {
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
    log(`[${n + 1}/${input.pdfs.length}] resource ${pdf.resourceId}: ${describe(outcome)}`);
  }
  report.ms = Date.now() - started;
  return report;
}

function describe(outcome: IndexManualOutcome): string {
  switch (outcome.status) {
    case "indexed":
      return (
        `${outcome.documentStatus}${outcome.reason ? ` (${outcome.reason})` : ""}, ${outcome.pageCount ?? 0} pages, ` +
        `${outcome.outlineEntries} outline entries, ${outcome.chars} chars, ${(outcome.ms / 1000).toFixed(1)}s`
      );
    case "skipped":
      return `skipped (${outcome.reason.replace(/_/g, " ")})`;
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

// ── The command ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const { describeImportTarget, openImportTarget, resolveImportTarget } = await import("../src/lib/import/target.ts");
  const target = resolveImportTarget();
  console.log(`Target: ${describeImportTarget(target)}`);
  console.log(`Extractor: ${EXTRACTOR_VERSION}${options.dryRun ? " — dry run, nothing is written" : ""}`);

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
    const pdfs = await loadIndexTargets(opened.db, options);
    if (pdfs.length === 0) {
      console.log(options.force ? "No stored PDFs." : `Every stored PDF is already processed at ${EXTRACTOR_VERSION}.`);
      return;
    }
    console.log(`${pdfs.length} PDF(s) to process. No Gateway calls: extraction runs locally, at no cost.`);
    const report = await runIndexBackfill({
      db: opened.db,
      pdfs,
      dryRun: options.dryRun,
      force: options.force,
      log: (line) => console.log(line),
    });
    console.log(summarise(report, options.dryRun));
    if (report.counts.read_failed > 0) process.exitCode = 1;
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
