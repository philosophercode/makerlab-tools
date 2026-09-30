/**
 * Strip tracking parameters from stored resource links (manual text spec
 * amendment 2026-09-28; `src/lib/web/tracking-params.ts`,
 * `src/lib/manuals/link-backfill.ts`).
 *
 *   npm run resources:clean-urls              # dry run: what would change
 *   npm run resources:clean-urls -- --apply   # write it, one transaction
 *
 * `?utm_source=chatgpt.com` and its kind (`utm_*`, `gclid`, `fbclid`, YouTube's
 * `si` …) say where a click came from, not what the page is. New links are
 * stored without them; this cleans the ones already stored, and re-keys each
 * archived manual copy to the cleaned link so it stays the resource's current
 * PDF. Nothing is fetched and no model is called.
 *
 * Target: the import scripts' order (`src/lib/import/target.ts`) —
 * `DATABASE_URL`, else `PGLITE_DATA_DIR` (stop the dev server first).
 */
import { fileURLToPath } from "node:url";
import { PgliteLockedError } from "../src/lib/db/pglite-lock.ts";
import { applyTrackingCleanup, planTrackingCleanup } from "../src/lib/manuals/link-backfill.ts";

export function parseCleanArgs(argv: readonly string[]): { apply: boolean } {
  let apply = false;
  for (const arg of argv) {
    if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") apply = false;
    else throw new Error(`Unknown argument: ${arg}\nUsage: npm run resources:clean-urls -- [--apply]`);
  }
  return { apply };
}

async function main(): Promise<void> {
  const { apply } = parseCleanArgs(process.argv.slice(2));
  const { describeImportTarget, openImportTarget, resolveImportTarget } = await import("../src/lib/import/target.ts");
  const target = resolveImportTarget();
  console.log(`Target: ${describeImportTarget(target)} — ${apply ? "APPLY: changes will be written" : "DRY RUN: nothing is written"}\n`);

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
    const plans = await planTrackingCleanup(opened.db);
    for (const plan of plans) {
      console.log(`  ${plan.title}\n    ${plan.from}\n  → ${plan.to}${plan.archives.length ? `  (archived copy re-keyed)` : ""}`);
    }
    console.log(`\nResource links with tracking parameters: ${plans.length}`);
    if (!apply) {
      if (plans.length > 0) console.log("Dry run: nothing was written. Run again with --apply to clean them.");
      return;
    }
    const changed = await applyTrackingCleanup(opened.db, plans);
    console.log(`Applied: ${changed} link(s) cleaned.`);
  } finally {
    await opened.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
