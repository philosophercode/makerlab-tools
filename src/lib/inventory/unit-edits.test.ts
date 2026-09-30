// @vitest-environment node
import { nextCacheMock } from "../../../test/mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());

import { sql } from "drizzle-orm";
import { revalidateTag } from "next/cache";

import { readToolRevision } from "../data/tools";
import { createPgliteDb } from "../db/pglite";
import { maintenanceLogs, tools, units } from "../db/schema/index";
import type { Db } from "../db/types";
import { addUnit, editUnit, removeUnit, retireUnitForTool } from "./unit-edits";

/**
 * The Units section of the editor.
 *
 * The property this file is really about is the one `./tool-transaction.ts`
 * argues for: a unit write moves the **tool's** revision, so a second panel
 * finds out — and a *refused* unit write moves nothing, so nobody's token is
 * spent on a write that never happened.
 */

let db: Db;
let toolId: string;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  vi.mocked(revalidateTag).mockClear();
  await db.delete(maintenanceLogs);
  await db.delete(tools);
  await db.delete(units);
  const [row] = await db
    .insert(tools)
    .values({ slug: "form-4", name: "Form 4" })
    .returning({ id: tools.id });
  toolId = row.id;
});

async function revision(): Promise<string> {
  return (await readToolRevision(toolId, { db }))!;
}

/** Push the tool's `updated_at` so a revision comparison is deterministic. */
async function stageToolForward(): Promise<void> {
  await db.execute(sql`alter table tools disable trigger tools_set_updated_at`);
  await db.execute(sql`update tools set updated_at = updated_at - interval '1 second'`);
  await db.execute(sql`alter table tools enable trigger tools_set_updated_at`);
}

async function context() {
  return { toolId, expectedRevision: await revision(), db };
}

describe("addUnit", () => {
  it("adds the unit, moves the tool's revision and drops the catalogue cache", async () => {
    await stageToolForward();
    const before = await revision();

    const result = await addUnit({ toolId, expectedRevision: before, db }, { unitLabel: "Form 4 #1" });

    expect(result).toEqual({ ok: true, revision: expect.any(String), unitId: expect.any(String) });
    // The panel's token is the tool's, so a unit-only edit has to move it —
    // otherwise a second editor's stale token would still match.
    expect(result.ok && result.revision).not.toBe(before);
    expect(result.ok && result.revision).toBe(await revision());
    expect(await db.select().from(units)).toHaveLength(1);
    expect(revalidateTag).toHaveBeenCalledWith("catalog", { expire: 0 });
  });

  it("refuses a stale token and adds nothing", async () => {
    const stale = await revision();
    await addUnit({ toolId, expectedRevision: stale, db }, { unitLabel: "theirs" });
    // Staged, because PGlite's clock is millisecond-resolution: their write can
    // land inside the same millisecond as the token we read, which would leave
    // the token still matching. Real Postgres has microseconds and no such
    // window — see `data/revision.ts`.
    await stageToolForward();

    const result = await addUnit({ toolId, expectedRevision: stale, db }, { unitLabel: "mine" });

    expect(result).toEqual({ ok: false, error: "conflict" });
    expect((await db.select().from(units)).map((u) => u.unitLabel)).toEqual(["theirs"]);
  });

  it("rolls back the tool touch when the unit itself is refused", async () => {
    await addUnit(await context(), { unitLabel: "Form 4 #1", serialNumber: "SN-001" });
    await stageToolForward();
    const before = await revision();
    vi.mocked(revalidateTag).mockClear();

    const result = await addUnit(
      { toolId, expectedRevision: before, db },
      { unitLabel: "Form 4 #2", serialNumber: "sn-001" }
    );

    expect(result).toEqual({ ok: false, error: "duplicate_serial" });
    // **The whole point.** Bumping the revision for a write that never happened
    // would invalidate every open panel's token for nothing.
    expect(await revision()).toBe(before);
    expect(await db.select().from(units)).toHaveLength(1);
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});

describe("editUnit", () => {
  it("edits a unit and moves the tool with it", async () => {
    const added = await addUnit(await context(), { unitLabel: "Form 4 #1" });
    const unitId = (added as { unitId: string }).unitId;
    await stageToolForward();
    const before = await revision();

    const result = await editUnit({ toolId, expectedRevision: before, db }, unitId, {
      status: "out_of_service",
      condition: "needs_repair",
    });

    expect(result.ok).toBe(true);
    expect((await db.select().from(units))[0]).toMatchObject({
      status: "out_of_service",
      condition: "needs_repair",
    });
    expect(await revision()).not.toBe(before);
  });

  it("refuses a status outside the vocabulary without moving the tool", async () => {
    const added = await addUnit(await context(), { unitLabel: "Form 4 #1" });
    await stageToolForward();
    const before = await revision();

    const result = await editUnit({ toolId, expectedRevision: before, db }, (added as { unitId: string }).unitId, {
      status: "broken",
    });

    expect(result).toEqual({ ok: false, error: "invalid_field" });
    expect(await revision()).toBe(before);
  });
});

describe("retireUnitForTool and removeUnit", () => {
  it("retires a unit", async () => {
    const added = await addUnit(await context(), { unitLabel: "Form 4 #1" });

    const result = await retireUnitForTool(await context(), (added as { unitId: string }).unitId);

    expect(result.ok).toBe(true);
    expect((await db.select().from(units))[0].status).toBe("retired");
  });

  it("deletes a unit nothing refers to", async () => {
    const added = await addUnit(await context(), { unitLabel: "Form 4 #1" });

    const result = await removeUnit(await context(), (added as { unitId: string }).unitId);

    expect(result.ok).toBe(true);
    expect(await db.select().from(units)).toHaveLength(0);
  });

  it("refuses to delete a unit with maintenance history, and leaves the tool alone", async () => {
    const added = await addUnit(await context(), { unitLabel: "Form 4 #1" });
    const unitId = (added as { unitId: string }).unitId;
    await db.insert(maintenanceLogs).values({ title: "Resin tank cloudy", unitId, toolId });
    await stageToolForward();
    const before = await revision();

    const result = await removeUnit({ toolId, expectedRevision: before, db }, unitId);

    expect(result).toEqual({ ok: false, error: "unit_has_history" });
    expect(await db.select().from(units)).toHaveLength(1);
    expect(await revision()).toBe(before);
  });
});
