import { blobMode } from "../blob-mode.ts";
import { localBlobOrigin } from "../blob-local.ts";
import { localDataDir } from "../db/local-dir.ts";
import { createNeonDb } from "../db/neon.ts";
import { createPgliteDb, openPersistentPglite } from "../db/pglite.ts";
import type { Db } from "../db/types.ts";
import { createBlobUploader, createVercelBlobUploader } from "./blob-uploader.ts";
import type { BlobUploader } from "./files.ts";

/**
 * Where the import scripts (`import-notion`, `verify-import`, `db-migrate`)
 * write — the same precedence `getDb()` uses, so a local import lands exactly
 * where the dev server will read it:
 *
 * - `--dry-run` → a throwaway in-memory PGlite, whatever else is set;
 * - `DATABASE_URL` → that Postgres (Neon);
 * - `PGLITE_DATA_DIR` → the persistent local PGlite in that directory;
 * - neither → no target; the script says how to pick one.
 */
export type ImportTarget =
  | { kind: "memory" }
  | { kind: "neon"; url: string }
  | { kind: "pglite-local"; dir: string };

export class NoImportTargetError extends Error {
  constructor() {
    super(
      "No database to write to. Set DATABASE_URL (Neon), or PGLITE_DATA_DIR (a local database, e.g. .pglite-data), " +
        "or use --dry-run to rehearse in memory."
    );
    this.name = "NoImportTargetError";
  }
}

export function resolveImportTarget(options: { dryRun?: boolean } = {}): ImportTarget {
  if (options.dryRun) return { kind: "memory" };
  const url = process.env.DATABASE_URL;
  if (url) return { kind: "neon", url };
  const dir = localDataDir();
  if (dir) return { kind: "pglite-local", dir };
  throw new NoImportTargetError();
}

/** One line for the console, naming the target without its credentials. */
export function describeImportTarget(target: ImportTarget): string {
  switch (target.kind) {
    case "memory":
      return "an in-memory database (dry run; nothing is kept)";
    case "neon":
      return `DATABASE_URL (${safeHost(target.url)})`;
    case "pglite-local":
      return `the local PGlite database at ${target.dir}`;
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host || "Postgres";
  } catch {
    return "Postgres";
  }
}

export interface OpenedTarget {
  db: Db;
  close(): Promise<void>;
}

/**
 * Open the target's database. A local directory is migrated on open (and
 * throws `PgliteLockedError` while the dev server has it); Neon is not — run
 * `npm run db:migrate` first, as a deploy does.
 */
export async function openImportTarget(target: ImportTarget): Promise<OpenedTarget> {
  switch (target.kind) {
    case "memory":
      return { db: await createPgliteDb(), close: async () => {} };
    case "neon":
      return { db: createNeonDb(target.url), close: async () => {} };
    case "pglite-local":
      return openPersistentPglite(target.dir);
  }
}

/**
 * Where copied files go, per target.
 *
 * - Neon: Vercel Blob only. A shared database must never hold URLs that point
 *   at one person's laptop, so this still insists on `BLOB_READ_WRITE_TOKEN`.
 * - Local PGlite: whatever `blobMode()` allows — Vercel Blob with a token,
 *   otherwise `.blob-data/`, served by the dev server's `/api/dev-blob`.
 * - A dry run copies nothing.
 */
export function uploaderForTarget(target: ImportTarget): BlobUploader | null {
  switch (target.kind) {
    case "memory":
      return null;
    case "neon":
      return createVercelBlobUploader();
    case "pglite-local": {
      const uploader = createBlobUploader();
      if (!uploader) {
        throw new Error("No Blob store for files (BLOB_LOCAL_DISABLE is set?). Use --skip-files, or unset it.");
      }
      return uploader;
    }
  }
}

/** One line for the console naming where files will go. */
export function describeFileStore(target: ImportTarget): string {
  if (target.kind === "memory") return "none";
  if (target.kind === "neon" || blobMode() === "vercel") return "Vercel Blob";
  return `the local .blob-data/ store, served at ${localBlobOrigin()}/api/dev-blob/…`;
}
