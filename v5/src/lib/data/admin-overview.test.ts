// @vitest-environment node
import { createPgliteDb } from "../db/pglite";
import { seedDemo } from "../db/demo-seed";
import { maintenanceLogs } from "../db/schema/index";
import type { Db } from "../db/types";
import { SERIES_DAYS, fill, loadAdminOverview } from "./admin-overview";

/**
 * The `/admin` home's counts, against the demo seed in a real (in-process)
 * Postgres: each tile's number comes from the table it names, and the
 * sparkline series are zero-filled, oldest first, one entry per day.
 */

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb({ seed: seedDemo });
});

it("counts the demo seed's waiting work per surface", async () => {
  const o = await loadAdminOverview({ db });

  expect(o.inventory.total).toBe(2);
  expect(o.inventory.published).toBe(2);
  // Two researched items and one identified (DEMO_PENDING).
  expect(o.intake).toMatchObject({ researched: 2, identified: 1, researching: 0, failed: 0 });
  // One submission waiting on /admin/projects, one published.
  expect(o.projects).toEqual({ waiting: 1, published: 1 });
  expect(o.users.total).toBe(4);
  expect(o.users.admins).toBe(2);
  expect(o.refresh).toEqual({ proposed: 0, running: 0, failed: 0 });
});

it("puts a ticket reported today in the last slot of a 30-day series", async () => {
  const before = (await loadAdminOverview({ db })).series.tickets;
  await db.insert(maintenanceLogs).values({ title: "Belt slipping", status: "open", priority: "critical", dateReported: today() });

  const after = await loadAdminOverview({ db });
  expect(after.series.tickets).toHaveLength(SERIES_DAYS);
  expect(after.series.tickets.at(-1)).toBe((before.at(-1) ?? 0) + 1);
  expect(after.maintenance.urgent).toBeGreaterThanOrEqual(1);
});

describe("fill", () => {
  it("zero-fills and orders oldest first, ignoring days outside the window", () => {
    expect(fill([{ age: 0, n: 2 }, { age: "2", n: "5" }, { age: 9, n: 1 }], 3)).toEqual([5, 0, 2]);
  });
});

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
