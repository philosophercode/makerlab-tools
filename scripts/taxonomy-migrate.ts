/**
 * Taxonomy v2 recategorisation (docs/specs/2026-09-28-taxonomy-v2-design.md §5.1).
 *
 *   npm run taxonomy:migrate            # dry run: print the plan, write nothing
 *   npm run taxonomy:migrate -- --apply # write it, in one transaction
 *
 * Creates the nine top-level categories and their second level
 * (`src/lib/taxonomy/tree.ts`), moves every tool per the review's mapping
 * (`src/lib/taxonomy/mapping.ts`: by slug, then name, then old category), sets
 * `item_kind` / `parent_tool_id` where they are still the defaults (with the
 * move, or on a tool already placed — the report counts both), and
 * retires every old category left empty with `merged_into_id` naming where
 * its tools went. Deterministic and idempotent: a second run prints an empty
 * plan. The plan and the logic are `src/lib/taxonomy/migrate.ts`.
 *
 * - **Target** is the import scripts' order (`src/lib/import/target.ts`):
 *   `DATABASE_URL`, else `PGLITE_DATA_DIR`. A dry run reads the real target
 *   too — a plan of an empty in-memory database would say nothing.
 * - **Refuses while the dev server holds the local database** (the PGlite
 *   lock): stop `npm run dev` first. Production gets the result through
 *   `npm run data:push`, not by pointing this at Neon, unless you mean to.
 * - No model calls; nothing costs money.
 *
 * The catalogue is cached for minutes: the new categories show once it
 * expires (or after `POST /api/admin/revalidate`). The Notion mirror picks the
 * new tree up on its next push.
 */
import { fileURLToPath } from "node:url";
import { PgliteLockedError } from "../src/lib/db/pglite-lock.ts";
import { applyTaxonomyPlan, formatApplyReport, formatTaxonomyPlan, planIsEmpty, planTaxonomyMigration, readTaxonomySnapshot } from "../src/lib/taxonomy/migrate.ts";

export interface MigrateOptions {
  apply: boolean;
}

export function parseMigrateArgs(argv: readonly string[]): MigrateOptions {
  const unknown = argv.filter((arg) => arg !== "--apply" && arg !== "--dry-run");
  if (unknown.length) throw new Error(`Unknown argument(s): ${unknown.join(" ")}. Use --apply to write; the default is a dry run.`);
  return { apply: argv.includes("--apply") && !argv.includes("--dry-run") };
}

async function main(): Promise<void> {
  const options = parseMigrateArgs(process.argv.slice(2));
  const { describeImportTarget, openImportTarget, resolveImportTarget } = await import("../src/lib/import/target.ts");
  const target = resolveImportTarget();
  console.log(`Target: ${describeImportTarget(target)}${options.apply ? "" : " — dry run, nothing is written (--apply to write)"}`);

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
    const plan = planTaxonomyMigration(await readTaxonomySnapshot(opened.db));
    for (const line of formatTaxonomyPlan(plan)) console.log(line);
    if (planIsEmpty(plan)) {
      console.log("Nothing to do: the taxonomy is already v2.");
      return;
    }
    if (!options.apply) {
      console.log("Dry run: nothing written. Run with --apply to write this plan.");
      return;
    }
    const report = await applyTaxonomyPlan(opened.db, plan);
    console.log(formatApplyReport(report));
    console.log("The catalogue is cached for minutes: the new categories show once it expires, or after POST /api/admin/revalidate.");
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
