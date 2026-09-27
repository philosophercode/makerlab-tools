// @vitest-environment node
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
  expect(o.users).toMatchObject({ total: 5, admins: 2, blocked: 0 });
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
  // A fixed clock: noon in New York, so the test means the same thing at any hour.
  const now = new Date("2026-09-24T16:00:00.000Z");
  const before = await loadAdminOverview(["maintenance", "corrections"], { db, now });
  await db.insert(maintenanceLogs).values({ title: "Belt slipping", status: "open", priority: "critical", dateReported: "2026-09-24" });
  await db.insert(feedback).values({ issueDescription: "Wrong photo", status: "new", createdAt: now });

  const after = await loadAdminOverview(["maintenance", "corrections"], { db, now });
  expect(after.maintenance?.series.at(-1)).toBe((before.maintenance?.series.at(-1) ?? 0) + 1);
  expect(after.maintenance?.urgent).toBe((before.maintenance?.urgent ?? 0) + 1);
  expect(after.corrections?.series.at(-1)).toBe((before.corrections?.series.at(-1) ?? 0) + 1);
  expect(after.corrections?.open).toBe((before.corrections?.open ?? 0) + 1);
});

describe("the series' days are the lab's days (LAB_TIMEZONE, default America/New_York)", () => {
  // 23:30 on 2026-09-24 in New York is 03:30 on the 25th in UTC — the hour the
  // old `current_date` bucketing got wrong.
  const lateEvening = new Date("2026-09-25T03:30:00.000Z");

  beforeEach(() => {
    vi.stubEnv("LAB_TIMEZONE", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("counts a ticket and a correction filed at 23:30 Eastern as today's, in the last slot", async () => {
    const before = await loadAdminOverview(["maintenance", "corrections", "intake"], { db, now: lateEvening });
    await db.insert(maintenanceLogs).values({ title: "Fan rattles", status: "open", dateReported: "2026-09-24", createdAt: lateEvening });
    await db.insert(feedback).values({ issueDescription: "Late note", status: "new", createdAt: lateEvening });

    const after = await loadAdminOverview(["maintenance", "corrections", "intake"], { db, now: lateEvening });
    expect(after.maintenance?.series.at(-1)).toBe((before.maintenance?.series.at(-1) ?? 0) + 1);
    expect(after.corrections?.series.at(-1)).toBe((before.corrections?.series.at(-1) ?? 0) + 1);
    expect(after.maintenance?.series).toHaveLength(SERIES_DAYS);
  });

  it("buckets a timestamp by its lab date: 00:30 Eastern is the next day, not today", async () => {
    const before = await loadAdminOverview(["corrections"], { db, now: lateEvening });
    // 04:30 UTC on the 25th is 00:30 on the 25th in New York: tomorrow, from the
    // clock above — outside the window, never in today's slot.
    await db.insert(feedback).values({ issueDescription: "Tomorrow", status: "new", createdAt: new Date("2026-09-25T04:30:00.000Z") });
    const after = await loadAdminOverview(["corrections"], { db, now: lateEvening });
    expect(after.corrections?.series).toEqual(before.corrections?.series);
  });

  it("uses LAB_TIMEZONE when it is set", async () => {
    vi.stubEnv("LAB_TIMEZONE", "UTC");
    const before = await loadAdminOverview(["corrections"], { db, now: lateEvening });
    // In UTC the clock reads the 25th, so a correction at 03:00 UTC on the 25th is today's.
    await db.insert(feedback).values({ issueDescription: "UTC today", status: "new", createdAt: new Date("2026-09-25T03:00:00.000Z") });
    const after = await loadAdminOverview(["corrections"], { db, now: lateEvening });
    expect(after.corrections?.series.at(-1)).toBe((before.corrections?.series.at(-1) ?? 0) + 1);
  });
});

describe("fill", () => {
  it("zero-fills and orders oldest first, ignoring days outside the window", () => {
    expect(fill([{ age: 0, n: 2 }, { age: "2", n: "5" }, { age: 9, n: 1 }], 3)).toEqual([5, 0, 2]);
  });

  it("is all zeros for no rows", () => {
    expect(fill([], 4)).toEqual([0, 0, 0, 0]);
  });
});
