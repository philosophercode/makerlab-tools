/**
 * Thumbnails for public images already in Blob (performance, migration `0021`).
 *
 *   npm run thumbnails:backfill                 # dry run: list what would be rendered
 *   npm run thumbnails:backfill -- --apply      # render, upload and record them
 *   npm run thumbnails:backfill -- --apply --limit 20
 *
 * New uploads, approvals and accepted refresh covers get their thumbnails as
 * they happen (`src/lib/images/schedule-thumbnails.ts`). This is for the rows
 * that predate that, or whose run failed: every **owned**, public image
 * attachment with `thumbnails` null (unclaimed uploads are left to the daily
 * sweep). Each is downloaded from its public URL, resized to the standard
 * widths in AVIF and WebP (`src/lib/images/thumbnails.ts`), uploaded beside it
 * under `thumbs/…` and recorded on the row. A failure leaves the row as it was
 * — the page keeps showing the original — and is listed.
 *
 * - **Dry run by default**: nothing is downloaded or written.
 * - **Target** is the import scripts' order (`src/lib/import/target.ts`):
 *   `DATABASE_URL`, else `PGLITE_DATA_DIR` (stop the dev server first). The
 *   Blob store is `blobMode()`'s: `BLOB_READ_WRITE_TOKEN` (or `BLOB_STORE_ID`
 *   with OIDC) for Vercel Blob, else `.blob-data/` locally.
 * - Idempotent: a row that has thumbnails is never picked again.
 * - No model calls; the cost is Blob storage (~40 KB per image) and one
 *   download of each original.
 * - Afterwards `POST /api/admin/revalidate` (or wait for the catalogue cache
 *   to expire) so pages pick the thumbnails up.
 */
import { fileURLToPath } from "node:url";
import { blobMode } from "../src/lib/blob-mode.ts";
import { PgliteLockedError } from "../src/lib/db/pglite-lock.ts";
import type { Db } from "../src/lib/db/types.ts";
import { createThumbnailIO, listThumbnailCandidates, writeAttachmentThumbnails, type ThumbnailIO } from "../src/lib/images/attachment-thumbnails.ts";

export interface ThumbnailBackfillOptions {
  apply: boolean;
  limit?: number;
}

export function parseArgs(argv: readonly string[]): ThumbnailBackfillOptions {
  const options: ThumbnailBackfillOptions = { apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--dry-run") options.apply = false;
    else if (arg === "--limit") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n <= 0) throw new Error("--limit takes a positive whole number");
      options.limit = n;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export interface ThumbnailBackfillReport {
  candidates: number;
  written: string[];
  failed: string[];
}

/** List (and, with `apply`, render) every owned public image with no thumbnails. */
export async function runThumbnailBackfill(input: {
  db: Db;
  io: ThumbnailIO | null;
  options: ThumbnailBackfillOptions;
  log?: (line: string) => void;
}): Promise<ThumbnailBackfillReport> {
  const log = input.log ?? (() => {});
  const rows = await listThumbnailCandidates(input.db, { ownedOnly: true, limit: input.options.limit });
  const report: ThumbnailBackfillReport = { candidates: rows.length, written: [], failed: [] };
  for (const row of rows) {
    if (!input.options.apply) {
      log(`would render ${row.id} ${row.blobPathname}`);
      continue;
    }
    if (!input.io) throw new Error("No Blob store to write thumbnails to (BLOB_READ_WRITE_TOKEN, or run locally without BLOB_LOCAL_DISABLE).");
    const made = await writeAttachmentThumbnails(row, { db: input.db, io: input.io }).catch(() => null);
    if (made) {
      report.written.push(row.id);
      log(`rendered ${row.id} ${row.blobPathname} (${made.widths.join(", ")})`);
    } else {
      report.failed.push(row.id);
      log(`FAILED ${row.id} ${row.blobPathname}`);
    }
  }
  return report;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const { describeImportTarget, openImportTarget, resolveImportTarget } = await import("../src/lib/import/target.ts");
  const target = resolveImportTarget();
  console.log(`Target: ${describeImportTarget(target)}; Blob: ${blobMode()}${options.apply ? "" : " — dry run, nothing is written"}`);

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

  try {
    const report = await runThumbnailBackfill({ db: opened.db, io: createThumbnailIO(), options, log: (line) => console.log(line) });
    if (!options.apply) {
      console.log(`${report.candidates} image(s) need thumbnails. Run again with --apply to render them.`);
      return;
    }
    console.log(`Done: ${report.written.length} rendered, ${report.failed.length} failed, of ${report.candidates}.`);
    if (report.written.length > 0) console.log("POST /api/admin/revalidate (or wait for the catalogue cache) so pages use them.");
    if (report.failed.length > 0) process.exitCode = 1;
  } finally {
    await opened.close();
  }
}

// Only run when invoked directly, so tests can import the pieces.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
