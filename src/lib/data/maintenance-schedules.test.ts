// @vitest-environment node
import { eq } from "drizzle-orm";
import { expectViolation } from "../../../test/db";
import { insertUserRow } from "../../../test/utils/session";
import { createPgliteDb } from "../db/pglite";
import { maintenanceCompletions, maintenanceSchedules, tools, units, user } from "../db/schema/index";
import type { Db } from "../db/types";
import {
  completeSchedule,
  countDueSchedules,
  createSchedules,
  getSchedule,
  listActiveUnitsOfTool,
  listDueSchedules,
  listSchedules,
  setScheduleStatus,
  updateSchedule,
  type NewSchedule,
} from "./maintenance-schedules";

/**
 * Recurring maintenance against a real (in-process) Postgres (recurring
 * maintenance spec §10, amendment 2026-10-06): the due list, the check-off
 * that logs and rolls forward in one transaction, and the constraints that
 * keep a schedule well formed. Dates are passed in as the lab's today; the
 * timezone itself is `interval.test.ts`.
 */

let db: Db;
let toolId: string;
let unitA: string;
let unitB: string;
let actor: { userId: string; name: string };

const TODAY = "2026-10-06";

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  await db.delete(maintenanceCompletions);
  await db.delete(maintenanceSchedules);
  await db.delete(tools);
  await db.delete(user);
  const [laser] = await db.insert(tools).values({ slug: "trotec", name: "Trotec Speedy 400", published: true }).returning({ id: tools.id });
  const [a, b] = await db
    .insert(units)
    .values([
      { toolId: laser.id, unitLabel: "Laser A" },
      { toolId: laser.id, unitLabel: "Laser B" },
    ])
    .returning({ id: units.id });
  toolId = laser.id;
  unitA = a.id;
  unitB = b.id;
  const userId = `u-${Math.random().toString(36).slice(2)}`;
  await insertUserRow(db, { id: userId, email: `${userId}@cornell.edu`, name: "Sam Maker", role: "admin" });
  actor = { userId, name: "Sam Maker" };
});

function schedule(overrides: Partial<NewSchedule> = {}): NewSchedule {
  return {
    toolId,
    unitId: null,
    title: "Clean the laser lens",
    instructions: "Lens wipes only.",
    interval: { count: 1, unit: "week" },
    firstDueOn: TODAY,
    ...overrides,
  };
}

describe("creating and listing", () => {
  it("creates tool, unit and general-upkeep tasks, each listed with where it lives", async () => {
    await createSchedules(
      [
        schedule(),
        schedule({ unitId: unitA, title: "Empty the fume filter tray", firstDueOn: "2026-10-01" }),
        schedule({ toolId: null, title: "Wipe down workbenches", interval: { count: 1, unit: "day" }, firstDueOn: "2026-10-07" }),
      ],
      actor,
      { db }
    );
    const list = await listSchedules({ db });
    expect(list.map((s) => s.title)).toEqual(["Empty the fume filter tray", "Clean the laser lens", "Wipe down workbenches"]);
    const [filter, lens, benches] = list;
    expect(filter).toMatchObject({ toolName: "Trotec Speedy 400", toolSlug: "trotec", unitLabel: "Laser A", status: "active" });
    expect(lens).toMatchObject({ unitId: null, unitLabel: null, interval: { count: 1, unit: "week" }, lastDoneOn: null, recent: [] });
    expect(benches).toMatchObject({ toolId: null, toolName: null, interval: { count: 1, unit: "day" } });
  });

  it("lists a tool's units still in the lab for 'each unit'", async () => {
    await db.update(units).set({ status: "retired" }).where(eq(units.id, unitB));
    expect(await listActiveUnitsOfTool(toolId, { db })).toEqual([{ id: unitA, label: "Laser A" }]);
    expect(await listActiveUnitsOfTool("not-a-uuid", { db })).toEqual([]);
  });
});

describe("the due list", () => {
  beforeEach(async () => {
    await createSchedules(
      [
        schedule({ title: "Overdue", firstDueOn: "2026-10-03" }),
        schedule({ title: "Today", firstDueOn: TODAY }),
        schedule({ title: "This week", firstDueOn: "2026-10-13" }),
        schedule({ title: "Later", firstDueOn: "2026-10-14" }),
      ],
      actor,
      { db }
    );
  });

  it("shows overdue, today and the next 7 days, oldest first, with days overdue", async () => {
    const due = await listDueSchedules(TODAY, { db });
    expect(due.map((d) => [d.title, d.state, d.overdueDays])).toEqual([
      ["Overdue", "overdue", 3],
      ["Today", "today", 0],
      ["This week", "soon", 0],
    ]);
  });

  it("shows only today and overdue for 0 days ahead", async () => {
    const due = await listDueSchedules(TODAY, { db, withinDays: 0 });
    expect(due.map((d) => d.title)).toEqual(["Overdue", "Today"]);
  });

  it("leaves paused and archived tasks out however late they are", async () => {
    const [overdue] = await db.select().from(maintenanceSchedules).where(eq(maintenanceSchedules.title, "Overdue"));
    await setScheduleStatus(overdue.id, "paused", actor, { db });
    expect((await listDueSchedules(TODAY, { db })).map((d) => d.title)).toEqual(["Today", "This week"]);
    expect(await countDueSchedules(TODAY, { db })).toEqual({ overdue: 0, dueToday: 1, soon: 1, active: 3 });
  });

  it("counts overdue, due today, soon and active in one read", async () => {
    expect(await countDueSchedules(TODAY, { db })).toEqual({ overdue: 1, dueToday: 1, soon: 1, active: 4 });
  });
});

describe("Done", () => {
  let id: string;

  beforeEach(async () => {
    [id] = await createSchedules([schedule({ firstDueOn: "2026-10-03" })], actor, { db });
  });

  it("logs the completion and moves the next due date to today + interval, in one go", async () => {
    const result = await completeSchedule({ id, note: "Lens was smoky.", expectedDueOn: "2026-10-03", today: TODAY, actor }, { db });
    expect(result).toMatchObject({ ok: true, doneOn: TODAY, nextDueOn: "2026-10-13" });

    const after = await getSchedule(id, { db });
    expect(after).toMatchObject({ lastDoneOn: TODAY, nextDueOn: "2026-10-13" });
    expect(after?.recent).toEqual([
      expect.objectContaining({ doneOn: TODAY, dueOn: "2026-10-03", note: "Lens was smoky.", doneByName: "Sam Maker" }),
    ]);
    // It left the overdue list.
    expect(await countDueSchedules(TODAY, { db })).toMatchObject({ overdue: 0, dueToday: 0 });
  });

  it("refuses a second click on the same due date instead of logging the work twice", async () => {
    await completeSchedule({ id, note: null, expectedDueOn: "2026-10-03", today: TODAY, actor }, { db });
    const again = await completeSchedule({ id, note: null, expectedDueOn: "2026-10-03", today: TODAY, actor }, { db });
    expect(again).toEqual({ ok: false, error: "conflict" });
    expect(await db.select().from(maintenanceCompletions)).toHaveLength(1);
  });

  it("refuses a paused or archived task, and an unknown one", async () => {
    await setScheduleStatus(id, "paused", actor, { db });
    expect(await completeSchedule({ id, note: null, expectedDueOn: null, today: TODAY, actor }, { db })).toEqual({ ok: false, error: "conflict" });
    expect(
      await completeSchedule({ id: "00000000-0000-4000-8000-000000000000", note: null, expectedDueOn: null, today: TODAY, actor }, { db })
    ).toEqual({ ok: false, error: "not_found" });
    expect(await completeSchedule({ id: "nope", note: null, expectedDueOn: null, today: TODAY, actor }, { db })).toEqual({ ok: false, error: "not_found" });
  });

  it("keeps the latest five check-offs, newest first", async () => {
    let today = TODAY;
    for (let i = 0; i < 7; i++) {
      const result = await completeSchedule({ id, note: `run ${i}`, expectedDueOn: null, today, actor }, { db });
      expect(result.ok).toBe(true);
      today = result.ok ? result.nextDueOn : today;
    }
    const after = await getSchedule(id, { db });
    expect(after?.recent.map((c) => c.note)).toEqual(["run 6", "run 5", "run 4", "run 3", "run 2"]);
  });

  it("keeps the log, with the name, when the person's account is removed", async () => {
    await completeSchedule({ id, note: null, expectedDueOn: null, today: TODAY, actor }, { db });
    await db.delete(user).where(eq(user.id, actor.userId));
    const [row] = await db.select().from(maintenanceCompletions);
    expect(row).toMatchObject({ doneByUserId: null, doneByName: "Sam Maker" });
  });
});

describe("editing and status", () => {
  it("replaces the fields and keeps the log", async () => {
    const [id] = await createSchedules([schedule()], actor, { db });
    await completeSchedule({ id, note: null, expectedDueOn: null, today: TODAY, actor }, { db });
    const result = await updateSchedule(
      id,
      { toolId, unitId: unitB, title: "Clean lens and mirrors", instructions: null, interval: { count: 2, unit: "week" }, nextDueOn: "2026-10-20" },
      actor,
      { db }
    );
    expect(result).toEqual({ ok: true });
    const after = await getSchedule(id, { db });
    expect(after).toMatchObject({ title: "Clean lens and mirrors", unitLabel: "Laser B", interval: { count: 2, unit: "week" }, nextDueOn: "2026-10-20" });
    expect(after?.recent).toHaveLength(1);
  });

  it("answers not_found for an unknown schedule", async () => {
    expect(await setScheduleStatus("00000000-0000-4000-8000-000000000000", "archived", actor, { db })).toEqual({ ok: false, error: "not_found" });
    expect(await getSchedule("nope", { db })).toBeNull();
  });
});

describe("the table's guarantees", () => {
  it("refuses an interval outside 1–730, an unknown unit or status, and a unit without its tool", async () => {
    const base = { title: "x", intervalCount: 1, intervalUnit: "week", nextDueOn: TODAY };
    await expectViolation(db.insert(maintenanceSchedules).values({ ...base, intervalCount: 0 }), /maintenance_schedules_interval_count_check/);
    await expectViolation(db.insert(maintenanceSchedules).values({ ...base, intervalCount: 731 }), /maintenance_schedules_interval_count_check/);
    await expectViolation(db.insert(maintenanceSchedules).values({ ...base, intervalUnit: "year" }), /maintenance_schedules_interval_unit_check/);
    await expectViolation(db.insert(maintenanceSchedules).values({ ...base, status: "overdue" }), /maintenance_schedules_status_check/);
    await expectViolation(db.insert(maintenanceSchedules).values({ ...base, unitId: unitA }), /maintenance_schedules_unit_needs_tool_check/);
  });

  it("takes a deleted tool's schedules and their log with it", async () => {
    const [id] = await createSchedules([schedule({ unitId: unitA })], actor, { db });
    await completeSchedule({ id, note: null, expectedDueOn: null, today: TODAY, actor }, { db });
    await db.delete(tools).where(eq(tools.id, toolId));
    expect(await db.select().from(maintenanceSchedules)).toEqual([]);
    expect(await db.select().from(maintenanceCompletions)).toEqual([]);
  });

  it("stamps updated_at on a change (the trigger)", async () => {
    const [id] = await createSchedules([schedule()], actor, { db });
    const [before] = await db.select().from(maintenanceSchedules).where(eq(maintenanceSchedules.id, id));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await setScheduleStatus(id, "paused", actor, { db });
    const [after] = await db.select().from(maintenanceSchedules).where(eq(maintenanceSchedules.id, id));
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  });
});
