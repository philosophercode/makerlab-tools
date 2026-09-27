import type { LocalBlobBackend } from "../blob-local.ts";
import type { BlobUploader } from "../import/files.ts";
import { copyTables, countRows, type CopyLimits, type CopyResult } from "./copy.ts";
import { findEarlierUploads, scanLocalFiles, uploadFiles, type LocalFileScan } from "./files.ts";
import { migrationMismatch, readMigrationState, type RepoMigration } from "./migrations.ts";
import { emptyRewrites, type Row, type UploadedFile } from "./rows.ts";
import type { SqlClient } from "./sql.ts";
import { planTables, type CopyPlan } from "./tables.ts";

/**
 * `npm run data:push` without the command line: check, report, and — unless
 * it is a dry run or something is wrong — upload the local files and replace
 * the hosted rows. The script wires real connections to this; the integration
 * test wires two in-process PGlite databases and a fake uploader.
 *
 * Order matters for what a failure leaves behind:
 *   1. checks and counts (read-only on both sides);
 *   2. file uploads (a failure here leaves uploaded copies in Blob, reported,
 *      and the database untouched);
 *   3. one transaction on the target (a failure rolls it back entirely).
 */

export interface PushOptions {
  source: SqlClient;
  target: SqlClient;
  localStore: LocalBlobBackend;
  /** The local dev server's origin, besides loopback, that marks a URL as local. */
  localOrigin?: string;
  /** Null when the env file links no Blob store. */
  uploader: BlobUploader | null;
  /** The checkout's latest migration (null skips that part of the check). */
  repoMigration: RepoMigration | null;
  dryRun: boolean;
  /** Proceed even when some local rows' files are missing from `.blob-data/`. */
  allowMissingFiles?: boolean;
  plan?: CopyPlan;
  limits?: CopyLimits;
  log?: (line: string) => void;
}

export interface PushReport {
  /** False when a check failed; `problems` says why. Nothing was written. */
  ok: boolean;
  problems: string[];
  plan: CopyPlan;
  localCounts: Map<string, number | null>;
  targetCounts: Map<string, number | null>;
  files: LocalFileScan;
  /** Set after a real run. */
  /** Local files whose earlier upload (a previous push) is reused. */
  reused: number;
  copy?: CopyResult;
  uploaded?: number;
  uploadedBytes?: number;
}

export async function runPush(options: PushOptions): Promise<PushReport> {
  const log = options.log ?? (() => {});
  const plan = options.plan ?? planTables();
  const names = plan.tables.map((t) => t.name);

  // One read-only snapshot of the local database for the whole run.
  await options.source.query("begin transaction isolation level repeatable read read only");
  try {
    const localMigrations = await readMigrationState(options.source);
    const localCounts = await countRows(options.source, names);
    const attachments = (
      await options.source.query<{ r: Row }>("select to_jsonb(t) as r from attachments t")
    ).map((row) => row.r);
    const files = await scanLocalFiles(attachments, options.localStore, options.localOrigin);

    await options.target.query("begin transaction read only");
    let targetMigrations;
    let targetCounts;
    let earlier = new Map<string, UploadedFile>();
    try {
      targetMigrations = await readMigrationState(options.target);
      targetCounts = await countRows(options.target, [...names, ...plan.skipped]);
      if (files.files.length > 0 && targetCounts.get("attachments") != null) {
        const hosted = await options.target.query<{ r: Row }>(
          "select jsonb_build_object('id', id, 'access', access, 'blob_pathname', blob_pathname, " +
            "'public_url', public_url, 'size_bytes', size_bytes) as r from attachments"
        );
        earlier = findEarlierUploads(
          files.files,
          hosted.map((row) => row.r)
        );
      }
    } finally {
      await options.target.query("rollback");
    }
    const toUpload = files.files.filter((file) => !earlier.has(file.pathname));

    const problems: string[] = [];
    const mismatch = migrationMismatch(options.repoMigration, localMigrations, targetMigrations);
    if (mismatch) problems.push(mismatch);
    if (files.missing.length > 0 && !options.allowMissingFiles) {
      problems.push(
        `${files.missing.length} attachment row(s) point at local files that are missing from .blob-data/ ` +
          "(listed above). Fix or remove them locally, or pass --allow-missing-files to copy those rows unchanged."
      );
    }
    if (toUpload.length > 0 && !options.uploader) {
      problems.push(
        "There are local files to upload but the env file links no Blob store " +
          "(BLOB_READ_WRITE_TOKEN, or BLOB_STORE_ID + VERCEL_OIDC_TOKEN). Connect Blob to the project and pull again."
      );
    }

    printPlan(log, plan, localCounts, targetCounts, files, toUpload.length, earlier.size);
    const report: PushReport = {
      ok: problems.length === 0,
      problems,
      plan,
      localCounts,
      targetCounts,
      files,
      reused: earlier.size,
    };
    if (!report.ok || options.dryRun) return report;

    let rewrites = emptyRewrites();
    if (files.files.length > 0) {
      if (toUpload.length > 0) log(`\nUploading ${toUpload.length} file(s)…`);
      rewrites = await uploadFiles(
        files.files,
        options.localStore,
        options.uploader,
        (done, total) => {
          if (done === total || done % 25 === 0) log(`  ${done}/${total}`);
        },
        earlier
      );
    }
    report.uploaded = toUpload.length;
    report.uploadedBytes = toUpload.reduce((sum, file) => sum + file.size, 0);

    log("\nReplacing the hosted rows (one transaction)…");
    report.copy = await copyTables(options.source, options.target, plan, rewrites, options.limits, (name, rows) =>
      log(`  ${name.padEnd(22)} ${rows}`)
    );
    return report;
  } finally {
    await options.source.query("rollback").catch(() => {});
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function printPlan(
  log: (line: string) => void,
  plan: CopyPlan,
  local: Map<string, number | null>,
  target: Map<string, number | null>,
  files: LocalFileScan,
  toUpload: number,
  reused: number
): void {
  const show = (n: number | null | undefined) => (n === null || n === undefined ? "—" : String(n));
  log(`${"table".padEnd(22)} ${"local".padStart(8)} ${"hosted now".padStart(11)}`);
  for (const table of plan.tables) {
    log(`${table.name.padEnd(22)} ${show(local.get(table.name)).padStart(8)} ${show(target.get(table.name)).padStart(11)}`);
  }
  for (const name of plan.skipped) {
    log(`${name.padEnd(22)} ${"skipped".padStart(8)} ${show(target.get(name)).padStart(11)}  (sign-ins never travel)`);
  }
  const blanked = plan.tables.filter((t) => t.redacted.length > 0);
  if (blanked.length > 0) {
    log(`Blanked on the way: ${blanked.map((t) => `${t.name}.{${t.redacted.join(",")}}`).join("  ")}`);
  }
  log(`\nLocal files: ${files.files.length} (${formatBytes(files.bytes)})`);
  log(`  to upload: ${toUpload}${reused > 0 ? `   already on the hosted store from an earlier push: ${reused}` : ""}`);
  if (files.missing.length > 0) {
    log(`Missing from .blob-data/ (${files.missing.length}):`);
    for (const m of files.missing.slice(0, 20)) log(`  attachment ${m.id}  ${m.pathname}`);
    if (files.missing.length > 20) log(`  … and ${files.missing.length - 20} more`);
  }
}
