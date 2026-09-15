/**
 * The one-time Notion → Postgres import (data platform design spec 2026-09-14
 * §5.7). Read-only against Notion; idempotent against Postgres.
 *
 *   npm run import:notion -- --dry-run      # into an in-memory PGlite, no files; prints the report
 *   npm run import:notion -- --skip-files   # into DATABASE_URL, rows only
 *   npm run import:notion                   # into DATABASE_URL, rows and files
 *
 * Needs `NOTION_API_KEY` and the `NOTION_DB_*` ids (plus `NOTION_DB_PROJECTS`
 * if projects should come across). A real run needs `DATABASE_URL`, and
 * `BLOB_READ_WRITE_TOKEN` unless `--skip-files`.
 *
 * The pre-flight stops the run on any Notion option that maps onto no stored
 * value, naming the database, property and option. That is deliberate.
 */
import { createNeonDb } from "../src/lib/db/neon.ts";
import { createPgliteDb } from "../src/lib/db/pglite.ts";
import { createVercelBlobUploader } from "../src/lib/import/blob-uploader.ts";
import { createFileCopier } from "../src/lib/import/files.ts";
import { PreflightError } from "../src/lib/import/preflight.ts";
import { runImport, type ImportReport } from "../src/lib/import/run.ts";
import { readNotionSnapshot } from "../src/lib/import/source.ts";

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

  console.log(dryRun ? "Dry run: reading Notion into an in-memory database." : "Reading Notion.");
  const snapshot = await readNotionSnapshot({ log });

  let db;
  if (dryRun) {
    db = await createPgliteDb();
  } else {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set. Use --dry-run to rehearse without a database.");
    db = createNeonDb(url);
  }

  const files = skipFiles ? null : createFileCopier(createVercelBlobUploader());

  console.log(dryRun ? "\nImporting (in memory)." : "\nImporting.");
  const report = await runImport({ db, snapshot, files, log });
  printReport(report);
  console.log(dryRun ? "\nDry run complete; nothing was written to a database." : "\nImport complete.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    if (error instanceof PreflightError) {
      console.error(`\n${error.message}`);
    } else {
      console.error(error);
    }
    process.exit(1);
  });
