// @vitest-environment node
import { sql } from "drizzle-orm";
import { createPgliteDb } from "../db/pglite";
import { DEMO_ACCOUNTS, seedDemo } from "../db/demo-seed";
import { feedback, maintenanceLogs } from "../db/schema/index";
import type { Db } from "../db/types";
import { COUNT_LOADERS } from "../admin/surfaces";
import { COUNT_LOADER_READS, SERIES_DAYS, fill, loadAdminOverview } from "./admin-overview";

/**
 * The `/admin` home's count loaders, against the demo seed in a real
 * (in-process) Postgres: each tile's number comes from the table it names,
 * only the loaders asked for run, a loader that fails is null (never zero),
 * and the sparkline series are zero-filled, oldest first, one entry per day.
 */

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb({ seed: seedDemo });
});

it("has a loader for every surface's count", () => {
  expect(Object.keys(COUNT_LOADER_READS).sort()).toEqual([...COUNT_LOADERS].sort());
});

it("counts the demo seed's waiting work per loader", async () => {
  const o = await loadAdminOverview([...COUNT_LOADERS], { db, userId: DEMO_ACCOUNTS.superAdmin.id });

  expect(o.inventory).toMatchObject({ total: 2, published: 2, draft: 0 });
  // Two researched items and one identified (DEMO_PENDING).
  expect(o.intake).toMatchObject({ researched: 2, identified: 1, researching: 0, failed: 0 });
  expect(o.intake?.series).toHaveLength(SERIES_DAYS);
  // One submission waiting on /admin/projects, one published.
  expect(o.projects).toEqual({ waiting: 1, published: 1 });
  expect(o.users).toMatchObject({ total: 4, admins: 2, banned: 0 });
  expect(o.refresh).toEqual({ proposed: 0, running: 0, failed: 0 });
  expect(o.maintenance).toMatchObject({ open: 1, urgent: 1 });
  expect(o.corrections?.open).toBeGreaterThanOrEqual(1);
  expect(o.mirror).toEqual({ state: "notConnected" });
});

it("reads only the loaders it is asked for", async () => {
  const o = await loadAdminOverview(["maintenance", "projects"], { db });
  expect(Object.keys(o).sort()).toEqual(["maintenance", "projects"]);
  // A SuperMaker's home never counts the people table it will not show.
  expect(o.users).toBeUndefined();
});

it("says a loader failed with null, and still answers the others", async () => {
  const spy = vi.spyOn(COUNT_LOADER_READS, "refresh").mockRejectedValueOnce(new Error("table gone"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  const o = await loadAdminOverview(["refresh", "projects"], { db });
  expect(o.refresh).toBeNull();
  expect(o.projects).toEqual({ waiting: 1, published: 1 });
  spy.mockRestore();
});

it("puts a ticket and a correction reported today in the last slot of their series", async () => {
  const before = await loadAdminOverview(["maintenance", "corrections"], { db });
  await db.insert(maintenanceLogs).values({ title: "Belt slipping", status: "open", priority: "critical", dateReported: await dbToday() });
  await db.insert(feedback).values({ issueDescription: "Wrong photo", status: "new" });

  const after = await loadAdminOverview(["maintenance", "corrections"], { db });
  expect(after.maintenance?.series.at(-1)).toBe((before.maintenance?.series.at(-1) ?? 0) + 1);
  expect(after.maintenance?.urgent).toBe((before.maintenance?.urgent ?? 0) + 1);
  expect(after.corrections?.series.at(-1)).toBe((before.corrections?.series.at(-1) ?? 0) + 1);
  expect(after.corrections?.open).toBe((before.corrections?.open ?? 0) + 1);
});

describe("fill", () => {
  it("zero-fills and orders oldest first, ignoring days outside the window", () => {
    expect(fill([{ age: 0, n: 2 }, { age: "2", n: "5" }, { age: 9, n: 1 }], 3)).toEqual([5, 0, 2]);
  });

  it("is all zeros for no rows", () => {
    expect(fill([], 4)).toEqual([0, 0, 0, 0]);
  });
});

/**
 * "Today" as the database's `current_date` sees it — the day the series
 * buckets by. A JavaScript UTC date disagrees with it for the hours around
 * midnight UTC (after 8pm in New York), which made this test fail every evening.
 */
async function dbToday(): Promise<string> {
  const result = (await db.execute(sql`select current_date::text as today`)) as { rows: Array<{ today: string }> };
  return result.rows[0].today;
}
