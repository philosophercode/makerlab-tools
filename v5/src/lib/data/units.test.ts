// @vitest-environment node
import { eq } from "drizzle-orm";
import { insertUserRow } from "../../../test/utils/session";
import { createPgliteDb } from "../db/pglite";
import { maintenanceLogs, tools, units, user } from "../db/schema/index";
import type { Db } from "../db/types";
import { createUnit, deleteUnit, retireUnit, updateUnit } from "./units";

/**
 * Unit writes against a real (in-process) Postgres.
 *
 * Two of these are the whole reason the module exists: a serial number the
 * index already holds comes back as a named refusal rather than a constraint
 * error nobody can render, and a unit with maintenance history cannot be
 * deleted at all (§5.3 "Deleting").
 */

let db: Db;
let toolId: string;
let otherToolId: string;
let actor: string;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  await db.delete(maintenanceLogs);
  // Deleting the tools cascades to their units.
  await db.delete(tools);
  await db.delete(units);
  await db.delete(user);

  actor = (await insertUserRow(db, { email: "niti@cornell.edu", role: "admin" })).id;
  const rows = await db
    .insert(tools)
    .values([
      { slug: "form-4", name: "Form 4" },
      { slug: "trotec", name: "Trotec Speedy 400" },
    ])
    .returning({ id: tools.id });
  toolId = rows[0].id;
  otherToolId = rows[1].id;
});

async function readUnit(id: string) {
  const [row] = await db.select().from(units).where(eq(units.id, id));
  return row;
}

async function addUnit(label: string, extra: Record<string, unknown> = {}): Promise<string> {
  const created = await createUnit(db, toolId, { unitLabel: label, ...extra }, actor);
  if (!created.ok) throw new Error(`fixture failed: ${created.reason}`);
  return created.unitId;
}

describe("createUnit", () => {
  it("adds a unit with the fields the editor offers", async () => {
    const created = await createUnit(
      db,
      toolId,
      {
        unitLabel: "  Form 4 #2  ",
        serialNumber: "SN-002",
        assetTag: "CT-91",
        status: "under_maintenance",
        condition: "fair",
        dateAcquired: "2026-02-01",
      },
      actor
    );

    expect(created.ok).toBe(true);
    const row = await readUnit((created as { unitId: string }).unitId);
    expect(row).toMatchObject({
      toolId,
      unitLabel: "Form 4 #2",
      serialNumber: "SN-002",
      assetTag: "CT-91",
      status: "under_maintenance",
      condition: "fair",
      dateAcquired: "2026-02-01",
      createdBy: actor,
      updatedBy: actor,
    });
  });

  it("defaults to available, and leaves condition unknown rather than inventing one", async () => {
    const row = await readUnit(await addUnit("Form 4 #1"));
    expect(row.status).toBe("available");
    expect(row.condition).toBeNull();
  });

  it("refuses a second unit with a serial the tool already has, case and all", async () => {
    await addUnit("Form 4 #1", { serialNumber: "SN-001" });

    const again = await createUnit(
      db,
      toolId,
      { unitLabel: "Form 4 #2", serialNumber: "sn-001" },
      actor
    );

    // The index is `lower(serial_number)` per tool — the "is this actually a
    // second machine?" check (§4.5), surfaced as something a panel can say.
    expect(again).toEqual({ ok: false, reason: "duplicate_serial" });
  });

  it("lets another tool hold the same serial", async () => {
    await addUnit("Form 4 #1", { serialNumber: "SN-001" });

    const elsewhere = await createUnit(
      db,
      otherToolId,
      { unitLabel: "Trotec #1", serialNumber: "SN-001" },
      actor
    );

    expect(elsewhere.ok).toBe(true);
  });

  it("refuses a value outside the vocabulary before Postgres sees it", async () => {
    for (const input of [
      { unitLabel: "x", status: "broken" },
      { unitLabel: "x", condition: "mint" },
      { unitLabel: "x", dateAcquired: "last tuesday" },
      { unitLabel: "   " },
    ]) {
      expect(await createUnit(db, toolId, input, actor)).toEqual({
        ok: false,
        reason: "invalid_field",
      });
    }
    expect(await db.select().from(units)).toHaveLength(0);
  });
});

describe("updateUnit", () => {
  it("edits the fields and stamps the author", async () => {
    const unitId = await addUnit("Form 4 #1", { notes: "kept" });

    const written = await updateUnit(
      db,
      { toolId, unitId },
      { status: "out_of_service", condition: "needs_repair" },
      actor
    );

    expect(written).toEqual({ ok: true, unitId });
    const row = await readUnit(unitId);
    expect(row).toMatchObject({
      status: "out_of_service",
      condition: "needs_repair",
      notes: "kept",
      updatedBy: actor,
    });
  });

  it("does not reach a unit belonging to another tool", async () => {
    const unitId = await addUnit("Form 4 #1");

    const written = await updateUnit(db, { toolId: otherToolId, unitId }, { status: "retired" });

    expect(written).toEqual({ ok: false, reason: "not_found" });
    expect((await readUnit(unitId)).status).toBe("available");
  });

  it("refuses a duplicate serial on an edit too", async () => {
    await addUnit("Form 4 #1", { serialNumber: "SN-001" });
    const second = await addUnit("Form 4 #2", { serialNumber: "SN-002" });

    const written = await updateUnit(db, { toolId, unitId: second }, { serialNumber: "SN-001" });

    expect(written).toEqual({ ok: false, reason: "duplicate_serial" });
    expect((await readUnit(second)).serialNumber).toBe("SN-002");
  });
});

describe("retireUnit and deleteUnit", () => {
  it("retires by status, keeping the row and its history", async () => {
    const unitId = await addUnit("Form 4 #1");

    expect(await retireUnit(db, { toolId, unitId }, actor)).toEqual({ ok: true, unitId });
    expect((await readUnit(unitId)).status).toBe("retired");
  });

  it("deletes a unit nothing refers to", async () => {
    const unitId = await addUnit("Form 4 #1");

    expect(await deleteUnit(db, { toolId, unitId })).toEqual({ ok: true, unitId });
    expect(await readUnit(unitId)).toBeUndefined();
  });

  it("refuses to delete a unit with maintenance history, and keeps the ticket attached", async () => {
    const unitId = await addUnit("Form 4 #1");
    await db.insert(maintenanceLogs).values({
      title: "Resin tank cloudy",
      unitId,
      toolId,
      status: "open",
    });

    const deleted = await deleteUnit(db, { toolId, unitId });

    // `maintenance_logs.unit_id` is `on delete set null`, so Postgres would
    // have allowed this and quietly detached the ticket.
    expect(deleted).toEqual({ ok: false, reason: "unit_has_history" });
    expect(await readUnit(unitId)).toBeDefined();
    const [log] = await db.select().from(maintenanceLogs);
    expect(log.unitId).toBe(unitId);

    // Retiring is the answer the panel offers instead.
    expect(await retireUnit(db, { toolId, unitId }, actor)).toEqual({ ok: true, unitId });
  });

  it("does not delete a unit belonging to another tool", async () => {
    const unitId = await addUnit("Form 4 #1");

    expect(await deleteUnit(db, { toolId: otherToolId, unitId })).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await readUnit(unitId)).toBeDefined();
  });
});
