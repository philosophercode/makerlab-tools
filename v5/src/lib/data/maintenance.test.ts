// @vitest-environment node
import { createPgliteDb } from "../db/pglite";
import { maintenanceLogs, tools, units } from "../db/schema/index";
import type { Db } from "../db/types";
import {
  listMaintenanceHistoryForUnit,
  toDisplayLabel,
  toMaintenanceHistoryEntry,
} from "./maintenance";

/**
 * Maintenance history against a real (in-process) Postgres, plus the
 * stored-value → display-string translation on its own.
 */

let db: Db;
let unitId: string;
let otherUnitId: string;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  await db.delete(maintenanceLogs);
  // Deleting the tools cascades to their units.
  await db.delete(tools);

  const [form4] = await db
    .insert(tools)
    .values({ slug: "form-4", name: "Form 4", published: true })
    .returning({ id: tools.id });
  const [unitA, unitB] = await db
    .insert(units)
    .values([
      { toolId: form4.id, unitLabel: "Form 4 // A" },
      { toolId: form4.id, unitLabel: "Form 4 // B" },
    ])
    .returning({ id: units.id });
  unitId = unitA.id;
  otherUnitId = unitB.id;
});

type LogValues = typeof maintenanceLogs.$inferInsert;

async function insertLog(values: Partial<LogValues> = {}): Promise<void> {
  await db.insert(maintenanceLogs).values({
    title: "Resin tank cloudy",
    unitId,
    ...values,
  });
}

// ── listMaintenanceHistoryForUnit ───────────────────────────────────

describe("listMaintenanceHistoryForUnit", () => {
  it("returns the unit's logs with the display strings the assistant has always seen", async () => {
    await insertLog({
      title: "Resin tank cloudy",
      type: "issue_report",
      priority: "high",
      status: "in_progress",
      description: "The resin tank film is clouded.",
      resolution: "Tank swapped.",
      dateReported: "2024-09-01",
      dateResolved: "2024-09-03",
      reportedByName: "Ada Lovelace",
    });

    const [entry] = await listMaintenanceHistoryForUnit(unitId, { db });

    expect(entry).toMatchObject({
      title: "Resin tank cloudy",
      type: "Issue Report",
      priority: "High",
      status: "In Progress",
      description: "The resin tank film is clouded.",
      resolution: "Tank swapped.",
      dateReported: "2024-09-01",
      dateResolved: "2024-09-03",
      reportedByName: "Ada Lovelace",
    });
  });

  it("never returns the reporter's email (spec §8)", async () => {
    await insertLog({
      reportedByName: "Ada Lovelace",
      reportedByEmail: "ada@cornell.edu",
    });

    const [entry] = await listMaintenanceHistoryForUnit(unitId, { db });

    expect(entry.reportedByName).toBe("Ada Lovelace");
    // Not "undefined" — the address must not be a key at all, so no caller can
    // spread it into a prompt or a mirror payload.
    expect(Object.keys(entry)).not.toContain("reportedByEmail");
    expect(JSON.stringify(entry)).not.toContain("cornell.edu");
  });

  it("orders newest first and sorts an undated log last", async () => {
    await insertLog({ title: "Oldest", dateReported: "2024-01-01" });
    await insertLog({ title: "Undated", dateReported: null });
    await insertLog({ title: "Newest", dateReported: "2024-09-01" });

    const titles = (await listMaintenanceHistoryForUnit(unitId, { db })).map(
      (log) => log.title
    );
    expect(titles).toEqual(["Newest", "Oldest", "Undated"]);
  });

  it("reads only the requested unit's logs", async () => {
    await insertLog({ title: "Mine" });
    await insertLog({ title: "Theirs", unitId: otherUnitId });

    const titles = (await listMaintenanceHistoryForUnit(unitId, { db })).map(
      (log) => log.title
    );
    expect(titles).toEqual(["Mine"]);
  });

  it("bounds the read with `limit`, keeping the most recent", async () => {
    for (let i = 0; i < 12; i += 1) {
      await insertLog({ title: `Issue ${i}`, dateReported: `2024-09-${String(i + 1).padStart(2, "0")}` });
    }

    const logs = await listMaintenanceHistoryForUnit(unitId, { db, limit: 10 });
    expect(logs).toHaveLength(10);
    expect(logs[0].title).toBe("Issue 11");
  });

  it("is empty for a unit with no history", async () => {
    expect(await listMaintenanceHistoryForUnit(unitId, { db })).toEqual([]);
  });

  it("is empty for anything that is not a uuid, without querying", async () => {
    // A unit label that failed to resolve must not reach Postgres as a cast.
    expect(await listMaintenanceHistoryForUnit("Form 4 // A", { db })).toEqual([]);
    expect(await listMaintenanceHistoryForUnit("", { db })).toEqual([]);
  });
});

// ── Row → entry ─────────────────────────────────────────────────────

describe("toMaintenanceHistoryEntry", () => {
  it("turns every absent value into an empty string", () => {
    expect(
      toMaintenanceHistoryEntry({
        id: "log-1",
        title: "Untriaged",
        type: null,
        priority: null,
        status: null,
        description: null,
        resolution: null,
        dateReported: null,
        dateResolved: null,
        reportedByName: null,
      })
    ).toEqual({
      id: "log-1",
      title: "Untriaged",
      type: "",
      priority: "",
      status: "",
      description: "",
      resolution: "",
      dateReported: "",
      dateResolved: "",
      reportedByName: "",
    });
  });
});

describe("toDisplayLabel", () => {
  it("maps every stored maintenance value back to the words Notion showed", () => {
    expect(toDisplayLabel("issue_report")).toBe("Issue Report");
    expect(toDisplayLabel("preventive_maintenance")).toBe("Preventive Maintenance");
    expect(toDisplayLabel("repair")).toBe("Repair");
    expect(toDisplayLabel("inspection")).toBe("Inspection");
    expect(toDisplayLabel("calibration")).toBe("Calibration");
    expect(toDisplayLabel("critical")).toBe("Critical");
    expect(toDisplayLabel("open")).toBe("Open");
    expect(toDisplayLabel("in_progress")).toBe("In Progress");
    expect(toDisplayLabel("resolved")).toBe("Resolved");
    expect(toDisplayLabel("closed")).toBe("Closed");
  });

  it("returns an empty string for a missing value", () => {
    expect(toDisplayLabel(null)).toBe("");
    expect(toDisplayLabel(undefined)).toBe("");
    expect(toDisplayLabel("")).toBe("");
  });
});
