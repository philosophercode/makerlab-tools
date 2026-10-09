// @vitest-environment node
import { nextCacheMock } from "../../../test/mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());

import { getDb, resetDbForTests } from "../db/client";
import { maintenanceCompletions, maintenanceSchedules, tools } from "../db/schema/index";
import { labToday } from "../lab-time";
import { addInterval } from "../maintenance/interval";
import { staff, staffPromptFragment } from "./staff";
import type { CapabilityCtx } from "./types";

/**
 * `list_maintenance_due` (recurring maintenance spec, amendment 2026-10-06):
 * "what's due today?" answered from the database — overdue and due tasks
 * only, with the lab's dates, and nothing for a student (the permission is
 * enforced by the adapters; `access.test.ts` pins who is offered it).
 */

const tool = staff.tools.find((t) => t.name === "list_maintenance_due")!;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("LAB_TIMEZONE", "America/New_York");
  const db = await getDb();
  await db.delete(maintenanceCompletions);
  await db.delete(maintenanceSchedules);
});

afterEach(async () => {
  const db = await getDb();
  await db.delete(maintenanceSchedules);
  resetDbForTests();
});

async function seed() {
  const db = await getDb();
  const today = labToday();
  const [laser] = await db.insert(tools).values({ slug: "due-laser", name: "Due Laser", published: true }).onConflictDoNothing().returning({ id: tools.id });
  const toolId = laser?.id ?? (await db.query.tools.findFirst({ where: (t, { eq }) => eq(t.slug, "due-laser") }))!.id;
  await db.insert(maintenanceSchedules).values([
    { toolId, title: "Clean the lens", intervalCount: 1, intervalUnit: "week", nextDueOn: addInterval(today, { count: 1, unit: "day" }) },
    { toolId: null, title: "Wipe down workbenches", intervalCount: 1, intervalUnit: "day", nextDueOn: today },
    { toolId, title: "Empty the dust collector", intervalCount: 1, intervalUnit: "month", nextDueOn: "2020-01-01", status: "paused" },
    { toolId: null, title: "Sweep the floor", intervalCount: 2, intervalUnit: "week", nextDueOn: addInterval(today, { count: 30, unit: "day" }) },
  ]);
  return today;
}

it("is a staff read on maintenance.manage", () => {
  expect(tool.kind).toBe("read");
  expect(tool.requiredPermission).toBe("maintenance.manage");
  expect(tool.chatOnly).toBeFalsy();
  expect(tool.mcpOnly).toBeFalsy();
});

it("lists today's and this week's tasks with where, how often and the due state, never a paused one", async () => {
  const today = await seed();
  const result = (await tool.run({}, {} as CapabilityCtx)) as { today: string; count: number; tasks: Record<string, unknown>[] };
  expect(result.today).toBe(today);
  expect(result.tasks.map((t) => t.title)).toEqual(["Wipe down workbenches", "Clean the lens"]);
  expect(result.tasks[0]).toMatchObject({ where: "General lab upkeep", every: "every 1 day", state: "due_today", overdue_days: 0 });
  expect(result.tasks[1]).toMatchObject({ where: "Due Laser", every: "every 1 week", state: "upcoming" });
});

it("narrows to today with within_days 0, and to one tool by name", async () => {
  await seed();
  const todayOnly = (await tool.run({ within_days: 0 }, {} as CapabilityCtx)) as { tasks: { title: string }[] };
  expect(todayOnly.tasks.map((t) => t.title)).toEqual(["Wipe down workbenches"]);
  const laserOnly = (await tool.run({ tool: "laser" }, {} as CapabilityCtx)) as { tasks: { title: string }[] };
  expect(laserOnly.tasks.map((t) => t.title)).toEqual(["Clean the lens"]);
});

it("tells staff, and only staff, to use it and to send them to Done", () => {
  const text = staffPromptFragment({ tools: [], identity: { role: "admin", userId: "u", email: "a@cornell.edu", name: "A", rateLimitKey: "u" } });
  expect(text).toContain("list_maintenance_due");
  expect(text).toMatch(/cannot check a task off/);
  expect(staffPromptFragment({ tools: [], identity: { role: "user", userId: "s", email: "s@cornell.edu", name: "S", rateLimitKey: "s" } })).toBe("");
});
