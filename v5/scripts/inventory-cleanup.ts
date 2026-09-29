/**
 * Apply the reviewed inventory cleanup of 2026-09-28
 * (`data/inventory-cleanup-2026-09-28/`, its `report.md` lists every change):
 * manual links, display-name and unit-label fixes, spam tags off, starter
 * questions for tools with none, tracking parameters off resource links.
 *
 *   npm run inventory:cleanup                    # dry run: what would change
 *   npm run inventory:cleanup -- --apply         # write it
 *   npm run inventory:cleanup -- --apply --include-low   # also low-confidence manual links
 *   npm run inventory:cleanup -- --apply --revalidate https://makerlab-ai.vercel.app
 *   npm run inventory:cleanup -- --bundle data/inventory-cleanup-2026-09-28-bambu-ams [--apply]
 *
 * - **`--bundle <dir>`** applies a later, smaller bundle: only the files it
 *   has (a missing file is empty). Besides the 2026-09-28 files it may hold
 *   `manuals-add.json` (a Manual beside the tool's others) and
 *   `resources-retitle.json` (a resource renamed and retyped, by its URL).
 *
 * - **Target** is the import scripts' order (`src/lib/import/target.ts`):
 *   `DATABASE_URL`, else `PGLITE_DATA_DIR`. The local database is
 *   single-process — the command refuses while the dev server holds it.
 * - **Dry run is the default** and reads the real target; it writes nothing.
 * - **Idempotent**: every change is conditional on the value it replaces; a
 *   second run reports `already` and writes nothing. See `inventory-cleanup/apply.ts`.
 * - **After**: the nightly manual archive copies the new manuals' PDFs, then
 *   `npm run manuals:index` reads them. The catalogue cache expires on its own;
 *   `--revalidate <site>` drops it now (`POST /api/admin/revalidate` with
 *   `ADMIN_REVALIDATE_SECRET`).
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PgliteLockedError } from "../src/lib/db/pglite-lock.ts";
import { loadBundle } from "./inventory-cleanup/bundle.ts";
import { runCleanup, type CleanupReport } from "./inventory-cleanup/apply.ts";

export interface CleanupArgs {
  apply: boolean;
  includeLow: boolean;
  revalidate: string | null;
  /** A bundle directory other than the 2026-09-28 one, relative to the working directory. */
  bundle: string | null;
}

export function parseArgs(argv: readonly string[]): CleanupArgs {
  const args: CleanupArgs = { apply: false, includeLow: false, revalidate: null, bundle: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--dry-run") args.apply = false;
    else if (arg === "--include-low") args.includeLow = true;
    else if (arg === "--bundle") {
      const dir = argv[++i];
      if (!dir || dir.startsWith("--")) throw new Error("--bundle needs a directory, e.g. data/inventory-cleanup-2026-09-28-bambu-ams");
      args.bundle = dir;
    } else if (arg === "--revalidate") {
      const site = argv[++i];
      if (!site || !/^https?:\/\//.test(site)) throw new Error("--revalidate needs the site's URL, e.g. https://makerlab-ai.vercel.app");
      args.revalidate = site.replace(/\/+$/, "");
    } else throw new Error(`Unknown argument ${arg}. Use --dry-run (default), --apply, --include-low, --bundle <dir>, --revalidate <site>.`);
  }
  return args;
}

export function summarize(report: CleanupReport): string[] {
  return Object.entries(report.counts).map(
    ([section, statuses]) => `${section}: ${Object.entries(statuses).map(([status, n]) => `${n} ${status}`).join(", ")}`
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const bundle = args.bundle ? loadBundle(resolve(args.bundle)) : loadBundle();
  if (args.bundle) console.log(`Bundle: ${resolve(args.bundle)}`);
  const { describeImportTarget, openImportTarget, resolveImportTarget } = await import("../src/lib/import/target.ts");
  const target = resolveImportTarget();
  console.log(`Target: ${describeImportTarget(target)}${args.apply ? "" : " — dry run, nothing is written"}`);

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
    const report = await runCleanup(opened.db, bundle, {
      apply: args.apply,
      includeLow: args.includeLow,
      log: (line) => console.log(line),
    });
    console.log("");
    for (const line of summarize(report)) console.log(line);
    const applied = report.changes.filter((change) => change.status === "applied").length;
    console.log(args.apply ? `${applied} change(s) written.` : `${applied} change(s) would be written. Run again with --apply.`);
    if (report.changes.some((change) => change.status === "refused")) process.exitCode = 1;

    if (args.apply && applied > 0) {
      if (args.revalidate) await revalidate(args.revalidate);
      else console.log("The catalogue cache expires on its own; --revalidate <site> drops it now.");
      console.log("New manuals: the nightly archive copies their PDFs; then run `npm run manuals:index`.");
    }
  } finally {
    await opened.close();
  }
}

async function revalidate(site: string): Promise<void> {
  const secret = process.env.ADMIN_REVALIDATE_SECRET;
  if (!secret) {
    console.log("ADMIN_REVALIDATE_SECRET is not set; the catalogue cache will expire on its own.");
    return;
  }
  const response = await fetch(`${site}/api/admin/revalidate`, { method: "POST", headers: { "x-admin-secret": secret } });
  console.log(`Revalidate ${site}: HTTP ${response.status}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
