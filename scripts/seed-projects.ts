/**
 * Seed the Projects gallery from the MakerLAB Director's public "Made in
 * MakerLAB" Notion database (bundle: `data/projects-seed/`).
 *
 *   PGLITE_DATA_DIR=.pglite-data npm run projects:seed -- --dry-run
 *   PGLITE_DATA_DIR=.pglite-data npm run projects:seed
 *
 * - **Target** is the import scripts' order (`src/lib/import/target.ts`):
 *   `DATABASE_URL`, else `PGLITE_DATA_DIR`. A local directory is
 *   single-process: **stop `npm run dev` first** — while it holds the lock this
 *   refuses with the pid to stop.
 * - **Photos** go through the import's uploader for that target: `.blob-data/`
 *   locally (URLs on `AUTH_BASE_URL`), Vercel Blob's **public** store for a
 *   `DATABASE_URL` target (a token is required). The usual hosted path is to
 *   seed locally and `npm run data:push`.
 * - **`--dry-run`** opens the target, reports what would be created, updated,
 *   uploaded and linked, and writes nothing. With no target set it rehearses
 *   against an empty in-memory database.
 * - **Idempotent:** re-runs update the same rows (keyed by Notion page id) and
 *   upload only new or changed photos. See `src/lib/projects-seed/apply.ts`.
 *
 * The gallery is cached for minutes; new projects appear once it expires (or
 * restart the dev server).
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PgliteLockedError } from "../src/lib/db/pglite-lock.ts";
import {
  describeFileStore,
  describeImportTarget,
  NoImportTargetError,
  openImportTarget,
  resolveImportTarget,
  uploaderForTarget,
  type ImportTarget,
} from "../src/lib/import/target.ts";
import { formatSeedReport, seedProjects } from "../src/lib/projects-seed/apply.ts";
import { DEFAULT_BUNDLE_DIR, loadSeedBundle } from "../src/lib/projects-seed/bundle.ts";

export interface SeedArgs {
  dryRun: boolean;
  bundleDir: string;
}

export function parseArgs(argv: string[]): SeedArgs {
  const args: SeedArgs = { dryRun: false, bundleDir: DEFAULT_BUNDLE_DIR };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--bundle") args.bundleDir = argv[++i] ?? DEFAULT_BUNDLE_DIR;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function pickTarget(dryRun: boolean): ImportTarget {
  try {
    return resolveImportTarget();
  } catch (error) {
    if (dryRun && error instanceof NoImportTargetError) return { kind: "memory" };
    throw error;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const bundleDir = resolve(process.cwd(), args.bundleDir);
  const bundle = loadSeedBundle(bundleDir);
  const target = pickTarget(args.dryRun);
  const uploader = args.dryRun ? null : uploaderForTarget(target);

  console.log(`Projects seed: ${bundle.projects.length} projects from ${bundle.source.name}`);
  console.log(`Database: ${describeImportTarget(target)}`);
  console.log(`Files: ${args.dryRun ? "none (dry run)" : describeFileStore(target)}\n`);

  let opened;
  try {
    opened = await openImportTarget(target);
  } catch (error) {
    if (error instanceof PgliteLockedError) {
      console.error(
        `Refusing to seed: ${error.message}\n` +
          `Stop the dev server (npm run dev, pid ${error.pid}), run this again, then restart it.`
      );
      process.exit(2);
    }
    throw error;
  }

  try {
    const report = await seedProjects({
      db: opened.db,
      bundle,
      imagesDir: resolve(bundleDir, "images"),
      uploader,
      dryRun: args.dryRun,
    });
    console.log(formatSeedReport(report));
    console.log(args.dryRun ? "\nDry run: nothing was written." : "\nSeed complete.");
  } finally {
    await opened.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
