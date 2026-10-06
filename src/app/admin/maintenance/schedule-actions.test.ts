// @vitest-environment node
import { nextCacheMock } from "../../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { actionById } from "../../../lib/actions/registry";
import { resetAuthForTests } from "../../../lib/auth/config";
import { getDb, resetDbForTests } from "../../../lib/db/client";
import { maintenanceCompletions, maintenanceSchedules, session, tools, units, user } from "../../../lib/db/schema/index";
import { labToday } from "../../../lib/lab-time";
import { addInterval } from "../../../lib/maintenance/interval";
import { signInAsNew } from "../../../../test/utils/session";
import { completeSchedule, createSchedule, editSchedule, setScheduleStatus } from "./schedule-actions";
import type { ScheduleFields } from "./schedule-result";

/**
 * The recurring-task server actions (recurring maintenance spec §8, §10,
 * amendment 2026-10-06): `maintenance.manage` on every one — a student and an
 * anonymous visitor are refused before anything is read — and the input rules
 * the form cannot be trusted to hold. Each goes through `performAction`, so
 * these are also the `schedules.*` definitions' tests.
 */

let toolId: string;
let unitA: string;
let otherUnit: string;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "schedule-actions-test-secret");
  vi.stubEnv("LAB_TIMEZONE", "America/New_York");
  resetAuthForTests();
  vi.mocked(revalidatePath).mockClear();
  const db = await getDb();
  await db.delete(maintenanceCompletions);
  await db.delete(maintenanceSchedules);
  await db.delete(session);
  await db.delete(user);
  const [form4, other] = await db
    .insert(tools)
    .values([
      { slug: "form-4-sched", name: "Form 4 (sched)", published: true },
      { slug: "other-sched", name: "Other (sched)", published: true },
    ])
    .returning({ id: tools.id });
  toolId = form4.id;
  const [a, , foreign] = await db
    .insert(units)
    .values([
      { toolId: form4.id, unitLabel: "Form 4 A" },
      { toolId: form4.id, unitLabel: "Form 4 B" },
      { toolId: other.id, unitLabel: "Other A" },
    ])
    .returning({ id: units.id });
  unitA = a.id;
  otherUnit = foreign.id;
});

afterEach(async () => {
  const db = await getDb();
  await db.delete(maintenanceSchedules);
  await db.delete(tools).where(eq(tools.id, toolId));
  await db.delete(tools).where(eq(tools.slug, "other-sched"));
  resetAuthForTests();
  resetDbForTests();
});

async function signIn(role: "user" | "admin" | "super_admin") {
  const signedIn = await signInAsNew({ email: `${role}-sched@cornell.edu`, role, name: "Sam Maker" });
  setMockHeaders({ cookie: signedIn.cookie });
  return signedIn;
}

function fields(overrides: Partial<ScheduleFields> = {}): ScheduleFields {
  return {
    title: "Clean the resin tank",
    instructions: "",
    toolId,
    unitId: null,
    eachUnit: false,
    intervalCount: 2,
    intervalUnit: "week",
    dueOn: labToday(),
    ...overrides,
  };
}

async function schedules() {
  const db = await getDb();
  return db.select().from(maintenanceSchedules);
}

describe("permissions", () => {
  it("refuses an anonymous visitor every action, before anything is written", async () => {
    setMockHeaders({});
    expect(await createSchedule(fields())).toEqual({ ok: false, error: "not_signed_in" });
    expect(await editSchedule({ scheduleId: "x", fields: fields() })).toEqual({ ok: false, error: "not_signed_in" });
    expect(await setScheduleStatus({ scheduleId: "x", status: "paused" })).toEqual({ ok: false, error: "not_signed_in" });
    expect(await completeSchedule({ scheduleId: "x", note: "", expectedDueOn: null })).toEqual({ ok: false, error: "not_signed_in" });
    expect(await schedules()).toEqual([]);
  });

  it("refuses a student (role user) every action", async () => {
    await signIn("admin");
    const created = await createSchedule(fields());
    expect(created).toMatchObject({ ok: true, created: 1 });
    const [row] = await schedules();

    await signIn("user");
    expect(await createSchedule(fields())).toEqual({ ok: false, error: "not_permitted" });
    expect(await editSchedule({ scheduleId: row.id, fields: fields({ title: "Hacked" }) })).toEqual({ ok: false, error: "not_permitted" });
    expect(await setScheduleStatus({ scheduleId: row.id, status: "archived" })).toEqual({ ok: false, error: "not_permitted" });
    expect(await completeSchedule({ scheduleId: row.id, note: "", expectedDueOn: null })).toEqual({ ok: false, error: "not_permitted" });

    const [after] = await schedules();
    expect(after).toMatchObject({ title: "Clean the resin tank", status: "active", lastDoneOn: null });
  });

  it("lets a SuperMaker (admin) and a director (super_admin) do every action", async () => {
    for (const role of ["admin", "super_admin"] as const) {
      await signIn(role);
      const created = await createSchedule(fields({ title: `Task for ${role}` }));
      expect(created, role).toMatchObject({ ok: true, created: 1 });
    }
    expect(await schedules()).toHaveLength(2);
  });

  it("holds every schedules action to maintenance.manage, GUI only", () => {
    for (const id of ["schedules.create", "schedules.update", "schedules.set_status", "schedules.complete"]) {
      const def = actionById(id);
      expect(def?.permission, id).toBe("maintenance.manage");
      expect(def?.assistant, id).toBe("never");
      expect(def?.mcp, id).toBe("never");
    }
  });
});

describe("create", () => {
  it("creates one task per unit for 'each unit', and refreshes the pages", async () => {
    await signIn("admin");
    expect(await createSchedule(fields({ eachUnit: true }))).toMatchObject({ ok: true, created: 2 });
    const rows = await schedules();
    expect(rows.map((r) => r.unitId).every(Boolean)).toBe(true);
    expect(new Set(rows.map((r) => r.unitId)).size).toBe(2);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/maintenance");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/maintenance/schedules");
  });

  it("creates general lab upkeep with no tool", async () => {
    await signIn("admin");
    expect(await createSchedule(fields({ toolId: null, title: "  Wipe down   workbenches ", intervalCount: 1, intervalUnit: "day" }))).toMatchObject({
      ok: true,
      created: 1,
    });
    const [row] = await schedules();
    expect(row).toMatchObject({ toolId: null, unitId: null, title: "Wipe down workbenches", intervalUnit: "day", nextDueOn: labToday() });
  });

  it("refuses bad input with invalid_field, and a tool that is gone with not_found", async () => {
    await signIn("admin");
    const cases: Partial<ScheduleFields>[] = [
      { title: "   " },
      { title: "x".repeat(121) },
      { intervalCount: 0 },
      { intervalCount: 731 },
      { intervalCount: 1.5 },
      { intervalUnit: "year" },
      { dueOn: "2026-02-30" },
      { dueOn: "1999-01-01" },
      { unitId: otherUnit },
      { toolId: null, unitId: unitA },
      { toolId: null, eachUnit: true },
    ];
    for (const overrides of cases) {
      expect(await createSchedule(fields(overrides)), JSON.stringify(overrides)).toEqual({ ok: false, error: "invalid_field" });
    }
    expect(await createSchedule(fields({ toolId: "00000000-0000-4000-8000-000000000000" }))).toEqual({ ok: false, error: "not_found" });
    const db = await getDb();
    await db.update(tools).set({ archivedAt: new Date() }).where(eq(tools.id, toolId));
    expect(await createSchedule(fields())).toEqual({ ok: false, error: "not_found" });
    expect(await schedules()).toEqual([]);
  });
});

describe("Done, edit and status", () => {
  it("checks a task off: logs it, names the person, and schedules the next time from today", async () => {
    await signIn("admin");
    await createSchedule(fields({ unitId: unitA, dueOn: addInterval(labToday(), { count: 1, unit: "day" }) }));
    const [row] = await schedules();
    const done = await completeSchedule({ scheduleId: row.id, note: "  Tank cloudy, replaced.  ", expectedDueOn: row.nextDueOn });
    expect(done).toEqual({ ok: true, nextDueOn: addInterval(labToday(), { count: 2, unit: "week" }) });
    const db = await getDb();
    const [log] = await db.select().from(maintenanceCompletions);
    expect(log).toMatchObject({ scheduleId: row.id, doneOn: labToday(), dueOn: row.nextDueOn, note: "Tank cloudy, replaced.", doneByName: "Sam Maker" });

    // A second click with the date the page showed is refused, not logged twice.
    expect(await completeSchedule({ scheduleId: row.id, note: "", expectedDueOn: row.nextDueOn })).toEqual({ ok: false, error: "conflict" });
    expect(await db.select().from(maintenanceCompletions)).toHaveLength(1);
  });

  it("edits a task, and refuses Done once it is paused", async () => {
    await signIn("admin");
    await createSchedule(fields());
    const [row] = await schedules();
    expect(await editSchedule({ scheduleId: row.id, fields: fields({ title: "Clean resin tank and tray", intervalCount: 1, intervalUnit: "month", unitId: unitA }) })).toEqual({
      ok: true,
    });
    const [edited] = await schedules();
    expect(edited).toMatchObject({ title: "Clean resin tank and tray", intervalCount: 1, intervalUnit: "month", unitId: unitA });

    expect(await setScheduleStatus({ scheduleId: row.id, status: "paused" })).toEqual({ ok: true });
    expect(await completeSchedule({ scheduleId: row.id, note: "", expectedDueOn: null })).toEqual({ ok: false, error: "conflict" });
    expect(await setScheduleStatus({ scheduleId: row.id, status: "overdue" })).toEqual({ ok: false, error: "invalid_field" });
    expect(await setScheduleStatus({ scheduleId: row.id, status: "active" })).toEqual({ ok: true });
  });

  it("keeps a task on a since-archived tool editable", async () => {
    await signIn("admin");
    await createSchedule(fields());
    const [row] = await schedules();
    const db = await getDb();
    await db.update(tools).set({ archivedAt: new Date() }).where(eq(tools.id, toolId));
    expect(await editSchedule({ scheduleId: row.id, fields: fields({ title: "Renamed" }) })).toEqual({ ok: true });
  });

  it("answers not_found for a task that does not exist", async () => {
    await signIn("admin");
    const missing = "00000000-0000-4000-8000-000000000000";
    expect(await editSchedule({ scheduleId: missing, fields: fields() })).toEqual({ ok: false, error: "not_found" });
    expect(await setScheduleStatus({ scheduleId: missing, status: "paused" })).toEqual({ ok: false, error: "not_found" });
    expect(await completeSchedule({ scheduleId: missing, note: "", expectedDueOn: null })).toEqual({ ok: false, error: "not_found" });
  });
});
