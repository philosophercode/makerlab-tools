/**
 * Check the lab config and floor plan (lab config spec 2026-10-25 §5.2).
 *
 *   npm run lab:check                 # the config, its public/ files, the plan
 *   npm run lab:check -- --inventory  # and how the database's locations land on the plan
 *
 * Validates `lab/lab.config.ts` and, when `map` is true, `lab/floor-plan.json`;
 * checks every file the config names exists under `public/`; prints what the
 * header, About and the assistant's "Where you are" will say. One line per
 * problem, and a non-zero exit when there is one. No network, no
 * credentials, no model calls.
 *
 * `--inventory` reads (never writes) the database — `DATABASE_URL`, else
 * `PGLITE_DATA_DIR`, else an in-memory one with the demo inventory — and lists the locations that land nowhere on the plan,
 * each with the `matches` line that would place it (§12.6), and the zones no
 * location uses.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import labFile from "../lab/lab.config.ts";
import { labSummary, missingPublicFiles, type InventoryLocation } from "../src/lib/lab/check.ts";
import { labConfigIssues } from "../src/lib/lab/schema.ts";
import { floorPlanIssues, floorPlanWarnings, toFloorPlan, floorPlanSchema } from "../src/lib/map/schema.ts";
import type { FloorPlan } from "../src/lib/map/types.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PLAN_PATH = join(ROOT, "lab", "floor-plan.json");

export function parseLabCheckArgs(argv: readonly string[]): { inventory: boolean } {
  const unknown = argv.filter((arg) => arg !== "--inventory");
  if (unknown.length) throw new Error(`Unknown argument(s): ${unknown.join(" ")}. The only option is --inventory.`);
  return { inventory: argv.includes("--inventory") };
}

async function main(): Promise<void> {
  const options = parseLabCheckArgs(process.argv.slice(2));
  const problems: string[] = [];

  const configIssues = labConfigIssues(labFile);
  problems.push(...configIssues.map((issue) => `lab/lab.config.ts ${issue}`));
  if (configIssues.length === 0) {
    const exists = (publicPath: string) => existsSync(join(ROOT, "public", publicPath));
    problems.push(...missingPublicFiles(labFile, exists).map((issue) => `lab/lab.config.ts ${issue}`));
  }

  let plan: FloorPlan | null = null;
  if (labFile.map) {
    if (!existsSync(PLAN_PATH)) problems.push("lab/floor-plan.json: missing, but the config says map: true");
    else {
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(PLAN_PATH, "utf8"));
      } catch (error) {
        problems.push(`lab/floor-plan.json: not valid JSON (${error instanceof Error ? error.message : error})`);
      }
      if (raw !== undefined) {
        problems.push(...floorPlanIssues(raw).map((issue) => `lab/floor-plan.json ${issue}`));
        for (const warning of floorPlanWarnings(raw)) console.warn(`warning: lab/floor-plan.json ${warning}`);
        const parsed = floorPlanSchema.safeParse(raw);
        if (parsed.success) plan = toFloorPlan(parsed.data);
      }
    }
  }

  if (configIssues.length === 0) {
    console.log("What the site will say:");
    for (const line of labSummary(labFile)) console.log(`  ${line}`);
    if (plan) console.log(`  Plan:        ${plan.title}, ${plan.zones.length} zones, ${plan.stations.length} stations`);
  }

  if (options.inventory && plan) {
    console.log("\nThe inventory against the plan:");
    for (const line of await inventoryLines(plan)) console.log(`  ${line}`);
  } else if (options.inventory) {
    console.log("\n--inventory: no plan to check the inventory against.");
  }

  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exitCode = 1;
  } else {
    console.log("\nlab:check passed.");
  }
}

async function inventoryLines(plan: FloorPlan): Promise<string[]> {
  const { describeImportTarget, openImportTarget, resolveImportTarget } = await import("../src/lib/import/target.ts");
  const { count, eq } = await import("drizzle-orm");
  const { locations, tools } = await import("../src/lib/db/schema/index.ts");
  const { inventoryReport } = await import("../src/lib/lab/check.ts");
  const configured = Boolean(process.env.DATABASE_URL || process.env.PGLITE_DATA_DIR);
  let opened: { db: Awaited<ReturnType<typeof openImportTarget>>["db"]; close(): Promise<void> };
  let described: string;
  if (configured) {
    const target = resolveImportTarget();
    opened = await openImportTarget(target);
    described = describeImportTarget(target);
  } else {
    // No database configured: an in-memory one, seeded with the demo inventory.
    const { createPgliteDb } = await import("../src/lib/db/pglite.ts");
    const { seedDemo } = await import("../src/lib/db/demo-seed.ts");
    opened = { db: await createPgliteDb({ seed: seedDemo }), close: async () => {} };
    described = "the demo inventory, in memory (set DATABASE_URL or PGLITE_DATA_DIR for yours)";
  }
  try {
    const rows: InventoryLocation[] = await opened.db
      .select({ room: locations.room, zone: locations.zone, mapTag: locations.mapTag, tools: count(tools.id) })
      .from(locations)
      .leftJoin(tools, eq(tools.locationId, locations.id))
      .groupBy(locations.id)
      .orderBy(locations.room, locations.zone);
    return [`Database: ${described}`, ...inventoryReport(plan, rows)];
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
