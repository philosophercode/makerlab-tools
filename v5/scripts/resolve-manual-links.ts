/**
 * Follow Manual links that are download pages to the PDF (manual text spec
 * amendment 2026-09-28 "Follow the download page to the PDF";
 * `src/lib/manuals/link-backfill.ts`).
 *
 *   npm run manuals:resolve-links              # dry run: what would change
 *   npm run manuals:resolve-links -- --apply   # write it, one transaction
 *
 * For every Manual resource with a web link and no stored PDF — the manual
 * archive refused it because the link is a page, not the file — this opens
 * the page through the SSRF-guarded fetch and looks for the PDF: a viewer's
 * iframe, a PDF.js `?file=`, a Download button, a Drive or Dropbox share (at
 * most 2 hops, the page's own site or a known file host, English only, the
 * archive's 25 MB limit). No model is called.
 *
 * `--apply` points each resource at its PDF and adds the page beside it as an
 * "Other" link ("… — download page"). The nightly manual archive then copies
 * the file; `npm run manuals:index` makes it searchable.
 *
 * Target: the import scripts' order (`src/lib/import/target.ts`) —
 * `DATABASE_URL`, else `PGLITE_DATA_DIR` (stop the dev server first).
 */
import { fileURLToPath } from "node:url";
import { PgliteLockedError } from "../src/lib/db/pglite-lock.ts";
import { applyManualPdfs, planManualPdfs } from "../src/lib/manuals/link-backfill.ts";

export function parseResolveArgs(argv: readonly string[]): { apply: boolean } {
  let apply = false;
  for (const arg of argv) {
    if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") apply = false;
    else throw new Error(`Unknown argument: ${arg}\nUsage: npm run manuals:resolve-links -- [--apply]`);
  }
  return { apply };
}

async function main(): Promise<void> {
  const { apply } = parseResolveArgs(process.argv.slice(2));
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
    const report = await planManualPdfs(opened.db, { log: (line) => console.log(line) });
    console.log(
      `\nManual links checked: ${report.checked}; resolved to a PDF: ${report.changes.length}; left as they are: ${report.unresolved.length}`
    );
    if (!apply) {
      if (report.changes.length > 0) console.log("Dry run: nothing was written. Run again with --apply to make these changes.");
      return;
    }
    const changed = await applyManualPdfs(opened.db, report.changes);
    console.log(`Applied: ${changed} resource(s) now point at their PDF. The nightly archive copies them; then run npm run manuals:index.`);
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
