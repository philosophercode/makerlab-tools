/**
 * Check an import against its source (data platform design spec 2026-09-14
 * §5.7, "Verification").
 *
 *   npm run verify:import
 *
 * Reads Notion again (read-only) and the import's target — `DATABASE_URL`, or
 * the local PGlite in `PGLITE_DATA_DIR` when that is unset (stop the dev
 * server first; see `src/lib/import/target.ts`) — then reports:
 *   - row counts per entity, Notion vs Postgres;
 *   - relation integrity: every unit and resource whose Notion relation points
 *     at a tool that exists has a `tool_id`;
 *   - files: every attachment row has bytes in Blob (Vercel Blob, or the local
 *     `.blob-data/` store for a local target without a token).
 *
 * Exits 1 on any mismatch. The field-by-field comparison of five named tools
 * between the Notion path and the Postgres path arrives with the Postgres read
 * path (Phase 2), which is what renders the Postgres side.
 */
import { head } from "@vercel/blob";
import { count, isNotNull } from "drizzle-orm";
import { blobMode } from "../src/lib/blob-mode.ts";
import { createLocalBlobBackend } from "../src/lib/blob-local.ts";
import { PgliteLockedError } from "../src/lib/db/pglite-lock.ts";
import {
  attachments,
  categories,
  feedback,
  locations,
  maintenanceLogs,
  projects,
  resources,
  tools,
  units,
} from "../src/lib/db/schema/index.ts";
import type { Db } from "../src/lib/db/types.ts";
import { readNotionSnapshot } from "../src/lib/import/source.ts";
import {
  describeImportTarget,
  NoImportTargetError,
  openImportTarget,
  resolveImportTarget,
  type ImportTarget,
} from "../src/lib/import/target.ts";

let failures = 0;

function check(label: string, expected: number, actual: number): void {
  const ok = expected === actual;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label.padEnd(40)} notion ${String(expected).padStart(5)}   postgres ${String(actual).padStart(5)}`);
}

async function rowCount(db: Db, table: typeof tools | typeof units | typeof categories | typeof locations | typeof resources | typeof maintenanceLogs | typeof feedback | typeof projects): Promise<number> {
  const [row] = await db.select({ n: count() }).from(table);
  return Number(row.n);
}

/** Whether a pathname has bytes in the store the import wrote to. */
function blobExists(target: ImportTarget): (pathname: string) => Promise<boolean> {
  if (target.kind === "pglite-local" && blobMode() === "local") {
    const disk = createLocalBlobBackend();
    return async (pathname) => (await disk.read(pathname)) !== null;
  }
  return async (pathname) => {
    try {
      await head(pathname);
      return true;
    } catch {
      return false;
    }
  };
}

async function main(): Promise<void> {
  const target = resolveImportTarget();
  console.log(`Target: ${describeImportTarget(target)}`);
  const opened = await openImportTarget(target);
  try {
    await verify(opened.db, target);
  } finally {
    await opened.close();
  }
}

async function verify(db: Db, target: ImportTarget): Promise<void> {
  console.log("Reading Notion.");
  const snapshot = await readNotionSnapshot({ log: (line) => console.log(`  ${line}`) });

  console.log("\nRow counts");
  check("categories", snapshot.categories.length, await rowCount(db, categories));
  check("locations", snapshot.locations.length, await rowCount(db, locations));
  check("tools", snapshot.tools.length, await rowCount(db, tools));
  check("units", snapshot.units.length, await rowCount(db, units));
  check("resources", snapshot.resources.length, await rowCount(db, resources));
  check("maintenance_logs", snapshot.maintenanceLogs.length, await rowCount(db, maintenanceLogs));
  check("feedback", snapshot.flags.length, await rowCount(db, feedback));
  check("projects", snapshot.projects.length, await rowCount(db, projects));

  console.log("\nRelations (Notion relations that point at an existing tool)");
  const toolIds = new Set(snapshot.tools.map((t) => t.id));
  const linkedUnits = snapshot.units.filter((u) => u.fields.tool?.some((id) => toolIds.has(id))).length;
  const [unitsWithTool] = await db.select({ n: count() }).from(units).where(isNotNull(units.toolId));
  check("units with a tool", linkedUnits, Number(unitsWithTool.n));
  const linkedResources = snapshot.resources.filter((r) => r.fields.tool?.some((id) => toolIds.has(id))).length;
  const [resourcesWithTool] = await db.select({ n: count() }).from(resources).where(isNotNull(resources.toolId));
  check("resources with a tool", linkedResources, Number(resourcesWithTool.n));

  console.log("\nFiles (every attachment row has bytes in Blob)");
  const rows = await db.select({ pathname: attachments.blobPathname }).from(attachments);
  const exists = blobExists(target);
  let missing = 0;
  for (const row of rows) {
    if (!(await exists(row.pathname))) {
      missing += 1;
      console.log(`  FAIL missing in Blob: ${row.pathname}`);
    }
  }
  if (missing > 0) failures += 1;
  console.log(`  ${missing === 0 ? "ok  " : "FAIL"} ${rows.length} attachments, ${missing} missing`);

  console.log(failures === 0 ? "\nVerified." : `\n${failures} check(s) failed.`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    if (error instanceof PgliteLockedError || error instanceof NoImportTargetError) {
      console.error(`\n${error.message}`);
    } else {
      console.error(error);
    }
    process.exit(1);
  });
