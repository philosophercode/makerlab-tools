/**
 * Taxonomy consolidation audit (docs/specs/2026-09-28-taxonomy-v2-design.md §5.4).
 *
 *   npm run taxonomy:audit              # write review proposals for what it finds
 *   npm run taxonomy:audit -- --dry-run # print the findings, write nothing
 *
 * Flags categories with 0–1 tools, categories over 25 tools, the same name
 * under two parents, and proposals pending over 14 days
 * (`src/lib/taxonomy/audit.ts`). **It only writes proposals** — each finding
 * waits on `/admin/taxonomy` for a person to merge or dismiss; nothing is
 * renamed, moved, merged or retired here. Idempotent: a finding already
 * waiting is not proposed twice.
 *
 * Target and lock handling are `taxonomy:migrate`'s: `DATABASE_URL`, else
 * `PGLITE_DATA_DIR`, and it refuses while the dev server holds the local
 * database. No model calls.
 */
import { fileURLToPath } from "node:url";
import { PgliteLockedError } from "../src/lib/db/pglite-lock.ts";
import { formatAudit, runTaxonomyAudit } from "../src/lib/taxonomy/audit.ts";

export function parseAuditArgs(argv: readonly string[]): { dryRun: boolean } {
  const unknown = argv.filter((arg) => arg !== "--dry-run");
  if (unknown.length) throw new Error(`Unknown argument(s): ${unknown.join(" ")}. The only option is --dry-run.`);
  return { dryRun: argv.includes("--dry-run") };
}

async function main(): Promise<void> {
  const options = parseAuditArgs(process.argv.slice(2));
  const { describeImportTarget, openImportTarget, resolveImportTarget } = await import("../src/lib/import/target.ts");
  const target = resolveImportTarget();
  console.log(`Target: ${describeImportTarget(target)}${options.dryRun ? " — dry run, nothing is written" : ""}`);

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
    const run = await runTaxonomyAudit(opened.db, { dryRun: options.dryRun });
    for (const line of formatAudit(run, options.dryRun)) console.log(line);
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
