/**
 * The one-time Notion → Postgres import (data platform design spec 2026-09-14
 * §5.7). Read-only against Notion; idempotent against Postgres.
 *
 *   npm run import:notion -- --dry-run      # into an in-memory PGlite, no files; prints the report
 *   npm run import:notion -- --skip-files   # into the target, rows only
 *   npm run import:notion                   # into the target, rows and files
 *
 * The target (`src/lib/import/target.ts`) is `DATABASE_URL` when set, else
 * `PGLITE_DATA_DIR` — a persistent local PGlite the dev server reads, for
 * reviewing the real inventory before it goes to Neon:
 *
 *   PGLITE_DATA_DIR=.pglite-data npm run import:notion
 *
 * Stop the dev server first: a PGlite directory is single-process, and the
 * run refuses a directory another process holds.
 *
 * Needs `NOTION_API_KEY` and the `NOTION_DB_*` ids (plus `NOTION_DB_PROJECTS`
 * if projects should come across). Files: a `DATABASE_URL` target needs
 * `BLOB_READ_WRITE_TOKEN` unless `--skip-files` (a shared database must never
 * point at a laptop); a local target uses Vercel Blob with a token and the
 * `.blob-data/` store otherwise, served by the dev server's `/api/dev-blob`.
 *
 * The pre-flight stops the run on any Notion option that maps onto no stored
 * value, naming the database, property and option. That is deliberate.
 */
import { PgliteLockedError } from "../src/lib/db/pglite-lock.ts";
import { createFileCopier } from "../src/lib/import/files.ts";
import { PreflightError } from "../src/lib/import/preflight.ts";
import { runImport, type ImportReport } from "../src/lib/import/run.ts";
import { readNotionSnapshot } from "../src/lib/import/source.ts";
import {
  describeFileStore,
  describeImportTarget,
  NoImportTargetError,
  openImportTarget,
  resolveImportTarget,
  uploaderForTarget,
} from "../src/lib/import/target.ts";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const skipFiles = args.has("--skip-files") || dryRun;

function printReport(report: ImportReport): void {
  console.log("\nRows");
  for (const [entity, { inserted, updated }] of Object.entries(report.counts)) {
    console.log(`  ${entity.padEnd(18)} ${String(inserted).padStart(5)} inserted ${String(updated).padStart(5)} updated`);
  }
  console.log(`\nFiles: ${report.files.copied} copied, ${report.files.skipped} skipped, ${report.files.failed} failed`);
  if (report.preflightWarnings.length > 0) {
    console.log("\nPre-flight warnings");
    for (const w of report.preflightWarnings) console.log(`  ${w.table}.${w.property}: ${w.reason}`);
  }
  if (report.warnings.length > 0) {
    console.log(`\nWarnings (${report.warnings.length})`);
    for (const w of report.warnings) console.log(`  ${w}`);
  }
}

async function main(): Promise<void> {
  const log = (line: string) => console.log(`  ${line}`);

  // Resolve and open the target before reading Notion, so a missing variable
  // or a locked local directory fails in a second rather than after the read.
  const target = resolveImportTarget({ dryRun });
  const uploader = skipFiles ? null : uploaderForTarget(target);
  console.log(`Target: ${describeImportTarget(target)}`);
  console.log(`Files:  ${skipFiles ? "skipped" : describeFileStore(target)}`);
  const opened = await openImportTarget(target);

  try {
    console.log("\nReading Notion.");
    const snapshot = await readNotionSnapshot({ log });

    const files = uploader ? createFileCopier(uploader) : null;
    console.log(`\nImporting into ${describeImportTarget(target)}.`);
    const report = await runImport({ db: opened.db, snapshot, files, log });
    printReport(report);
    console.log(dryRun ? "\nDry run complete; nothing was written to a database." : "\nImport complete.");
    if (target.kind === "pglite-local") {
      console.log("Start the dev server with the same PGLITE_DATA_DIR to review it.");
    }
  } finally {
    await opened.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    if (error instanceof PreflightError || error instanceof PgliteLockedError || error instanceof NoImportTargetError) {
      console.error(`\n${error.message}`);
    } else {
      console.error(error);
    }
    process.exit(1);
  });
