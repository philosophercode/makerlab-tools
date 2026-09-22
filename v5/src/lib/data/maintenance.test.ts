// @vitest-environment node
import { eq } from "drizzle-orm";
import { createPgliteDb } from "../db/pglite";
import { attachments, maintenanceLogs, tools, units } from "../db/schema/index";
import { MAINTENANCE_PRIORITY, MAINTENANCE_TYPE } from "../db/schema/vocabulary";
import { insertUserRow } from "../../../test/utils/session";
import type { Db } from "../db/types";
import {
  createMaintenanceLog,
  listMaintenanceHistoryForUnit,
  listMaintenanceQueue,
  toDisplayLabel,
  toMaintenanceHistoryEntry,
  toStoredValue,
  updateMaintenanceLog,
} from "./maintenance";

/**
 * Maintenance history against a real (in-process) Postgres, plus the
 * stored-value → display-string translation on its own.
 */

let db: Db;
let toolId: string;
let unitId: string;
let otherUnitId: string;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  vi.stubEnv("LAB_TIMEZONE", "America/New_York");
  await db.delete(attachments);
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
  toolId = form4.id;
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

// ── createMaintenanceLog (spec §4.8) ────────────────────────────────

describe("createMaintenanceLog", () => {
  /** Everything the filed row holds, read straight back out. */
  async function storedLog(id: string) {
    const [row] = await db.select().from(maintenanceLogs).where(eq(maintenanceLogs.id, id));
    return row;
  }

  it("copies the unit's tool and snapshots both display names", async () => {
    const created = await createMaintenanceLog(
      {
        title: "Resin tank cloudy",
        description: "Prints are coming out foggy.",
        type: "Issue Report",
        priority: "Medium",
        status: "Open",
        unitId,
      },
      { db }
    );

    const row = await storedLog(created.id);
    expect(row.unitId).toBe(unitId);
    // `tool_id` is copied from the unit at write time, and the two names are
    // snapshots so the history survives the unit being retired (§4.8).
    expect(row.toolId).toBe(toolId);
    expect(row.toolName).toBe("Form 4");
    expect(row.unitLabel).toBe("Form 4 // A");
    expect(created.toolId).toBe(toolId);
  });

  it("maps the capability's display casing down to the stored vocabulary", async () => {
    const created = await createMaintenanceLog(
      { title: "Bed not leveling", type: "Issue Report", priority: "Medium", status: "Open" },
      { db }
    );

    const row = await storedLog(created.id);
    // The CHECK constraints store snake_case; the capability speaks Notion's
    // select casing. A mismatch here fails the whole insert.
    expect(row.type).toBe("issue_report");
    expect(row.priority).toBe("medium");
    expect(row.status).toBe("open");
    // And it round-trips back to what the assistant has always seen.
    expect(toDisplayLabel(row.type)).toBe("Issue Report");
    expect(toDisplayLabel(row.priority)).toBe("Medium");
  });

  it("stores an unrecognised priority as null rather than failing the insert", async () => {
    const created = await createMaintenanceLog(
      { title: "Odd one", priority: "Spicy", type: "Issue Report" },
      { db }
    );

    // Losing a report of an unsafe machine to a priority spelled oddly is the
    // wrong failure (Article 4).
    const row = await storedLog(created.id);
    expect(row.priority).toBeNull();
    expect(row.title).toBe("Odd one");
  });

  it("files a ticket with no unit at all", async () => {
    const created = await createMaintenanceLog({ title: "Lab smells of solvent" }, { db });

    // No CHECK requires a unit: most live logs have neither unit nor tool, and
    // a ticket with no target is still a ticket (§4.8).
    const row = await storedLog(created.id);
    expect(row.unitId).toBeNull();
    expect(row.toolId).toBeNull();
    expect(row.status).toBe("open");
  });

  it("ignores a unit id that is not uuid-shaped", async () => {
    const created = await createMaintenanceLog(
      { title: "Unresolvable", unitId: "Form 4 // A" },
      { db }
    );

    expect((await storedLog(created.id)).unitId).toBeNull();
  });

  it("dates the ticket in the lab's timezone, not the server's", async () => {
    vi.stubEnv("LAB_TIMEZONE", "Pacific/Kiritimati");

    const created = await createMaintenanceLog({ title: "Dated" }, { db });

    // +14: the lab's day is reliably ahead of UTC's, which is what makes this
    // assertion about the timezone rather than about the clock.
    const row = await storedLog(created.id);
    expect(row.dateReported).toBe(created.dateReported);
    expect(row.dateReported).not.toBeNull();
    expect(row.dateReported! >= new Date().toISOString().slice(0, 10)).toBe(true);
  });

  it("writes reported_by_email only when one was passed, and never reads it back", async () => {
    // `created_by` references `user.id` since Phase 4; the reporter is a row.
    await insertUserRow(db, { id: "google-sub-1", email: "ada@cornell.edu" });
    const created = await createMaintenanceLog(
      {
        title: "Signed in",
        unitId,
        reportedByName: "Ada Lovelace",
        reportedByEmail: "ada@cornell.edu",
        reportedByUserId: "google-sub-1",
      },
      { db }
    );

    const row = await storedLog(created.id);
    expect(row.reportedByEmail).toBe("ada@cornell.edu");
    expect(row.reportedByName).toBe("Ada Lovelace");
    // The audit columns record who filed it.
    expect(row.createdBy).toBe("google-sub-1");

    // …and the history read never selects the email (spec §8, PII).
    const [entry] = await listMaintenanceHistoryForUnit(unitId, { db });
    expect(entry.reportedByName).toBe("Ada Lovelace");
    expect(JSON.stringify(entry)).not.toContain("ada@cornell.edu");
  });

  it("files anonymously with no reporter columns at all", async () => {
    const created = await createMaintenanceLog({ title: "Anonymous" }, { db });

    const row = await storedLog(created.id);
    expect(row.reportedByName).toBeNull();
    expect(row.reportedByEmail).toBeNull();
    expect(row.reportedByUserId).toBeNull();
    expect(row.createdBy).toBeNull();
  });

  it("claims the photos onto the new ticket and says how many stuck", async () => {
    const [photo] = await db
      .insert(attachments)
      .values({ blobPathname: "uploads/a.png", access: "private", contentType: "image/png" })
      .returning({ id: attachments.id });

    const created = await createMaintenanceLog(
      { title: "With a photo", unitId, photoAttachmentIds: [photo.id, "file-upload-2"] },
      { db }
    );

    expect(created.photosAttached).toBe(1);
    const [row] = await db.select().from(attachments).where(eq(attachments.id, photo.id));
    expect(row).toMatchObject({ ownerType: "maintenance_log", ownerId: created.id, position: 0 });
  });

  it("reports zero photos attached when none of the ids matched", async () => {
    const created = await createMaintenanceLog(
      { title: "Photo lost", photoAttachmentIds: ["file-upload-1"] },
      { db }
    );

    // Zero is what lets the capability tell the student the ticket was filed
    // without their picture instead of implying staff can see it.
    expect(created.photosAttached).toBe(0);
  });

  it("shows up in the unit's history immediately", async () => {
    await createMaintenanceLog(
      { title: "Freshly filed", type: "Issue Report", priority: "High", unitId },
      { db }
    );

    const history = await listMaintenanceHistoryForUnit(unitId, { db });
    expect(history.map((entry) => entry.title)).toEqual(["Freshly filed"]);
    expect(history[0].priority).toBe("High");
    // And only on that unit.
    expect(await listMaintenanceHistoryForUnit(otherUnitId, { db })).toEqual([]);
  });
});

describe("toStoredValue", () => {
  it("is the exact inverse of toDisplayLabel for every vocabulary value", () => {
    for (const value of [...MAINTENANCE_TYPE, ...MAINTENANCE_PRIORITY]) {
      const list = (MAINTENANCE_TYPE as readonly string[]).includes(value)
        ? MAINTENANCE_TYPE
        : MAINTENANCE_PRIORITY;
      expect(toStoredValue(toDisplayLabel(value), list)).toBe(value);
    }
  });

  it("accepts a value that is already stored-shaped", () => {
    expect(toStoredValue("issue_report", MAINTENANCE_TYPE)).toBe("issue_report");
  });

  it("returns null for anything outside the vocabulary", () => {
    expect(toStoredValue("Spicy", MAINTENANCE_PRIORITY)).toBeNull();
    expect(toStoredValue("", MAINTENANCE_PRIORITY)).toBeNull();
    expect(toStoredValue(null, MAINTENANCE_PRIORITY)).toBeNull();
    expect(toStoredValue(undefined, MAINTENANCE_PRIORITY)).toBeNull();
  });
});

describe("listMaintenanceQueue", () => {
  it("puts open work first, worst first, and dates the tie-break", async () => {
    await insertLog({ title: "Closed long ago", status: "closed", priority: "critical" });
    await insertLog({ title: "Open, low", status: "open", priority: "low" });
    await insertLog({ title: "In progress", status: "in_progress", priority: "critical" });
    await insertLog({ title: "Open, critical", status: "open", priority: "critical" });
    await insertLog({ title: "Open, unprioritised", status: "open", priority: null });

    const queue = await listMaintenanceQueue({ db });

    // Status first (the order MAINTENANCE_STATUS is declared in), then
    // priority, and a ticket with no priority after the ones that have one.
    expect(queue.map((entry) => entry.title)).toEqual([
      "Open, critical",
      "Open, low",
      "Open, unprioritised",
      "In progress",
      "Closed long ago",
    ]);
  });

  it("carries stored values, not the display text the history read returns", async () => {
    await insertLog({ status: "in_progress", priority: "high", type: "issue_report" });

    const [entry] = await listMaintenanceQueue({ db });

    expect(entry.status).toBe("in_progress");
    expect(entry.priority).toBe("high");
    expect(entry.type).toBe("issue_report");
    // The history read, whose rows a model sees, still translates.
    expect((await listMaintenanceHistoryForUnit(unitId, { db }))[0].status).toBe("In Progress");
  });

  it("names the tool it is about, preferring the live name over the snapshot", async () => {
    await insertLog({ toolId, toolName: "Form 4 (as filed)", unitLabel: "Form 4 // A" });
    await db.update(tools).set({ name: "Form 4 (renamed)" }).where(eq(tools.id, toolId));

    const [entry] = await listMaintenanceQueue({ db });

    expect(entry.toolName).toBe("Form 4 (renamed)");
    expect(entry.toolSlug).toBe("form-4");
    expect(entry.unitLabel).toBe("Form 4 // A");
  });

  it("falls back to the snapshot for a ticket whose tool is gone", async () => {
    await insertLog({ toolId: null, unitId: null, toolName: "A printer we sold" });

    const [entry] = await listMaintenanceQueue({ db });

    expect(entry.toolName).toBe("A printer we sold");
    expect(entry.toolSlug).toBeNull();
  });

  it("selects the reporter's address, which the history read deliberately does not", async () => {
    await insertLog({ reportedByName: "Casey", reportedByEmail: "casey@cornell.edu" });

    const [entry] = await listMaintenanceQueue({ db });
    expect(entry.reportedByEmail).toBe("casey@cornell.edu");

    // The read a model's answer is built from still has no way to leak it.
    const [history] = await listMaintenanceHistoryForUnit(unitId, { db });
    expect(JSON.stringify(history)).not.toContain("casey@cornell.edu");
  });

  it("is bounded", async () => {
    await insertLog({ title: "One" });
    await insertLog({ title: "Two" });

    expect(await listMaintenanceQueue({ db, limit: 1 })).toHaveLength(1);
  });
});

describe("updateMaintenanceLog", () => {
  async function onlyLog(): Promise<typeof maintenanceLogs.$inferSelect> {
    const [row] = await db.select().from(maintenanceLogs).limit(1);
    return row;
  }

  it("resolves a ticket and dates it in the lab's timezone, not the server's", async () => {
    // 01:30 UTC on the 3rd is still the 2nd in New York. A ticket resolved at
    // half nine on Tuesday evening must not be filed under Wednesday (§4.8).
    vi.setSystemTime(new Date("2026-03-03T01:30:00.000Z"));
    await insertLog();
    const before = await onlyLog();

    const result = await updateMaintenanceLog(before.id, { status: "resolved" }, { db });

    expect(result).toEqual({ ok: true });
    const after = await onlyLog();
    expect(after.status).toBe("resolved");
    expect(after.dateResolved).toBe("2026-03-02");
    vi.useRealTimers();
  });

  it("keeps the first resolution date when the note is edited afterwards", async () => {
    await insertLog();
    const { id } = await onlyLog();
    vi.setSystemTime(new Date("2026-03-02T15:00:00.000Z"));
    await updateMaintenanceLog(id, { status: "resolved" }, { db });

    vi.setSystemTime(new Date("2026-04-09T15:00:00.000Z"));
    await updateMaintenanceLog(id, { status: "closed", resolution: "Tank replaced" }, { db });

    const after = await onlyLog();
    expect(after.dateResolved).toBe("2026-03-02");
    expect(after.resolution).toBe("Tank replaced");
    vi.useRealTimers();
  });

  it("clears the resolution date when a ticket is reopened", async () => {
    await insertLog({ status: "resolved", dateResolved: "2026-03-02" });
    const { id } = await onlyLog();

    await updateMaintenanceLog(id, { status: "open" }, { db });

    expect((await onlyLog()).dateResolved).toBeNull();
  });

  it("assigns and unassigns, stamping who made the change", async () => {
    const staff = await insertUserRow(db, { email: "niti@cornell.edu", role: "admin" });
    await insertLog();
    const { id } = await onlyLog();

    await updateMaintenanceLog(
      id,
      { assignedToUserId: staff.id, assignedToName: staff.name },
      { db, actorUserId: staff.id }
    );
    let after = await onlyLog();
    expect(after.assignedToUserId).toBe(staff.id);
    expect(after.assignedToName).toBe(staff.name);
    expect(after.updatedBy).toBe(staff.id);

    await updateMaintenanceLog(id, { assignedToUserId: null, assignedToName: null }, { db });
    after = await onlyLog();
    expect(after.assignedToUserId).toBeNull();
    expect(after.assignedToName).toBeNull();
  });

  it("refuses a value outside the vocabulary before Postgres sees it, and writes nothing", async () => {
    await insertLog({ status: "open" });
    const { id } = await onlyLog();

    expect(await updateMaintenanceLog(id, { status: "spicy" }, { db })).toEqual({
      ok: false,
      reason: "invalid_field",
    });
    expect(await updateMaintenanceLog(id, { priority: "urgent" }, { db })).toEqual({
      ok: false,
      reason: "invalid_field",
    });

    expect((await onlyLog()).status).toBe("open");
  });

  it("answers not_found for an unknown id and for anything that is not a uuid", async () => {
    expect(await updateMaintenanceLog(crypto.randomUUID(), { status: "open" }, { db })).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await updateMaintenanceLog("form-4", { status: "open" }, { db })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("leaves the fields the patch does not mention alone", async () => {
    await insertLog({ priority: "high", description: "Cloudy after every print" });
    const { id } = await onlyLog();

    await updateMaintenanceLog(id, { status: "in_progress" }, { db });

    const after = await onlyLog();
    expect(after.priority).toBe("high");
    expect(after.description).toBe("Cloudy after every print");
  });
});
