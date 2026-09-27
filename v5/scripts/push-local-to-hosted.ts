/**
 * Copy this laptop's MakerLab data up to a hosted deployment, so a fresh
 * Vercel project starts exactly where local review left off
 * (docs/deploy.md, Part 2 step 5).
 *
 *   vercel env pull .env.hosted --environment=production
 *   npm run data:push -- --to .env.hosted --dry-run
 *   npm run data:push -- --to .env.hosted --yes
 *
 * Source: the local PGlite database (`PGLITE_DATA_DIR`, e.g. `.pglite-data`;
 * stop `npm run dev` first — it is single-process) and the local file store
 * (`.blob-data/`, or `BLOB_LOCAL_DIR`).
 * Target: the file named by `--to`: `DATABASE_URL` (Neon), and Blob via
 * `BLOB_READ_WRITE_TOKEN` or `BLOB_STORE_ID` + `VERCEL_OIDC_TOKEN`. Its values
 * are never printed and never enter `process.env`.
 *
 * A real run REPLACES the hosted rows (every app table; sign-ins excepted and
 * ended) and needs `--yes`. The hosted schema must already be migrated (the
 * app's build does it); the script refuses on any mismatch.
 *
 * Flags:
 *   --to <file>            the env file from `vercel env pull` (required)
 *   --dry-run              connect read-only, print counts and files, write nothing
 *   --yes                  confirm a real run
 *   --allow-missing-files  copy attachment rows whose local files are gone, unchanged
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import { createLocalBlobBackend, localBlobOrigin, localBlobRoot } from "../src/lib/blob-local.ts";
import { localDataDir } from "../src/lib/db/local-dir.ts";
import { migrationsFolder } from "../src/lib/db/migrations-folder.ts";
import { PGLITE_EXTENSIONS } from "../src/lib/db/pglite.ts";
import { acquirePgliteLock, PgliteLockedError, releasePgliteLock } from "../src/lib/db/pglite-lock.ts";
import { createHostedBlobUploader } from "../src/lib/push-hosted/blob-target.ts";
import { UploadFailedError } from "../src/lib/push-hosted/files.ts";
import { latestRepoMigration } from "../src/lib/push-hosted/migrations.ts";
import { formatBytes, runPush } from "../src/lib/push-hosted/run.ts";
import { sqlClient } from "../src/lib/push-hosted/sql.ts";
import { readEnvFile, resolveTargetCredentials, secretScrubber } from "../src/lib/push-hosted/target-env.ts";

export interface PushArgs {
  to: string | null;
  dryRun: boolean;
  yes: boolean;
  allowMissingFiles: boolean;
}

export function parseArgs(argv: string[]): PushArgs {
  const args: PushArgs = { to: null, dryRun: false, yes: false, allowMissingFiles: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--to") args.to = argv[++i] ?? null;
    else if (arg.startsWith("--to=")) args.to = arg.slice("--to=".length);
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--yes") args.yes = true;
    else if (arg === "--allow-missing-files") args.allowMissingFiles = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

/**
 * A readable message for anything thrown. The Neon driver rejects with a
 * WebSocket `ErrorEvent` (not an `Error`) when it cannot connect.
 */
export function describeError(error: unknown): string {
  const seen = new Set<unknown>();
  const visit = (value: unknown): string => {
    if (!value || typeof value !== "object" || seen.has(value)) return value ? String(value) : "";
    seen.add(value);
    const e = value as { message?: unknown; error?: unknown; cause?: unknown; code?: unknown };
    if (typeof e.message === "string" && e.message) return e.message;
    return visit(e.error) || visit(e.cause) || (typeof e.code === "string" ? e.code : "");
  };
  return visit(error) || "could not connect to the hosted database (check DATABASE_URL, and that you are online)";
}

const USAGE = "Usage: npm run data:push -- --to <env file> [--dry-run] [--yes] [--allow-missing-files]";

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.to) {
    console.error(USAGE);
    return 2;
  }
  if (!args.dryRun && !args.yes) {
    console.error(
      "A real run REPLACES the hosted database's rows. Rehearse with --dry-run, then run again with --yes.\n" + USAGE
    );
    return 2;
  }

  const envPath = resolve(process.cwd(), args.to);
  if (!existsSync(envPath)) {
    console.error(`No env file at ${args.to}. Create it with: vercel env pull ${args.to} --environment=production`);
    return 2;
  }
  const env = readEnvFile(envPath);
  const scrub = secretScrubber(env);
  const credentials = resolveTargetCredentials(env);

  const dir = localDataDir();
  if (!dir) {
    console.error("PGLITE_DATA_DIR is not set: point it at the local database, e.g. PGLITE_DATA_DIR=.pglite-data.");
    return 2;
  }
  if (!existsSync(join(dir, "pgdata"))) {
    console.error(`There is no local database at ${dir} (no pgdata/ inside). Check PGLITE_DATA_DIR.`);
    return 2;
  }

  console.log(args.dryRun ? "DRY RUN — nothing will be written.\n" : "REAL RUN — the hosted data will be replaced.\n");
  console.log(`From: the local database at ${dir}, files in ${localBlobRoot()}`);
  console.log(
    `To:   ${credentials.databaseVar} and ${credentials.blobVar ?? "no Blob store"}` +
      `${credentials.privateBlobVar ? ` (private files: ${credentials.privateBlobVar})` : ""} from ${args.to}\n`
  );

  // Opened without migrating: this run only reads the local database.
  acquirePgliteLock(dir);
  const local = new PGlite({ dataDir: join(dir, "pgdata"), extensions: PGLITE_EXTENSIONS });
  const pool = new Pool({ connectionString: credentials.databaseUrl });
  let hosted: PoolClient | null = null;
  try {
    hosted = await pool.connect();
    const report = await runPush({
      source: sqlClient(local),
      target: sqlClient(hosted),
      localStore: createLocalBlobBackend(),
      localOrigin: localBlobOrigin(),
      uploader: credentials.blob ? createHostedBlobUploader(credentials.blob, credentials.privateBlob) : null,
      repoMigration: latestRepoMigration(migrationsFolder()),
      dryRun: args.dryRun,
      allowMissingFiles: args.allowMissingFiles,
      log: (line) => console.log(scrub(line)),
    });

    if (!report.ok) {
      console.error("\nRefusing:");
      for (const problem of report.problems) console.error(`  - ${scrub(problem)}`);
      return 1;
    }
    if (args.dryRun) {
      console.log("\nDry run complete: nothing was written. Run again with --yes to replace the hosted data.");
      return 0;
    }

    const copy = report.copy!;
    const total = [...copy.rows.values()].reduce((a, b) => a + b, 0);
    console.log("\nDone.");
    console.log(`  rows copied:     ${total} across ${copy.rows.size} tables`);
    console.log(`  files uploaded:  ${report.uploaded ?? 0} (${formatBytes(report.uploadedBytes ?? 0)})${report.reused > 0 ? `, ${report.reused} reused from an earlier push` : ""}`);
    if (copy.relinked > 0) console.log(`  links restored:  ${copy.relinked} (self-references, second pass)`);
    console.log("  hosted sign-ins ended (sessions are not copied); sign in again on the hosted site.");
    if (copy.stillLocal.size > 0) {
      console.log("  WARNING: rows still mention the local file store (/api/dev-blob/):");
      for (const [table, n] of copy.stillLocal) console.log(`    ${table}: ${n}`);
    }
    console.log(`\nDelete ${args.to} when you are finished: it holds the production credentials.`);
    return 0;
  } catch (error) {
    if (error instanceof UploadFailedError) {
      console.error(`\n${scrub(error.message)}`);
      console.error(
        `The hosted database was not touched. ${error.uploaded.length} file(s) were already uploaded to Blob and are ` +
          "now unreferenced (the nightly sweep only removes files with a database row); delete them in the Vercel dashboard if they matter:"
      );
      for (const pathname of error.uploaded) console.error(`  ${pathname}`);
      return 1;
    }
    if (error instanceof PgliteLockedError) {
      console.error(error.message);
      return 1;
    }
    console.error(`\nFailed: ${scrub(describeError(error))}`);
    console.error(
      args.dryRun
        ? "Nothing was written."
        : "Any row changes were rolled back; the hosted database is as it was."
    );
    return 1;
  } finally {
    hosted?.release();
    await pool.end().catch(() => {});
    await local.close().catch(() => {});
    releasePgliteLock(dir);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      // Argument and env-file errors; their messages name variables, never values.
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
