// @vitest-environment node
import { eq, sql } from "drizzle-orm";
import { createPgliteDb } from "../db/pglite";
import { resources, tools, units, user } from "../db/schema/index";
import type { Db } from "../db/types";
import { createToolRecord } from "./tool-create";

/**
 * Creating a tool with its units and resources (spec §4.4, §5.4 step 11),
 * against a real (in-process) Postgres — the slug's unique index is the part
 * that only a database can exercise.
 */

let db: Db;
const ACTOR = "tool-create-actor";

beforeAll(async () => {
  db = await createPgliteDb();
  await db.insert(user).values({ id: ACTOR, name: "Actor", email: "actor@cornell.edu" });
});

beforeEach(async () => {
  await db.delete(tools);
});

describe("createToolRecord", () => {
  it("derives a slug and suffixes it on a collision", async () => {
    const first = await createToolRecord(db, { name: "Form 4", published: false }, ACTOR);
    const second = await createToolRecord(db, { name: "Form 4", published: false }, ACTOR);
    const third = await createToolRecord(db, { name: "form-4!", published: false }, ACTOR);
    expect([first.slug, second.slug, third.slug]).toEqual(["form-4", "form-4-2", "form-4-3"]);
  });

  it("retries a slug lost to a race in a savepoint, leaving the caller's transaction usable", async () => {
    // A race cannot be staged on one PGlite connection, so a trigger plays the
    // other writer: the first insert of this slug fails with 23505, exactly as
    // `tools_slug_unique` would if somebody took it between the read and the
    // insert. A sequence counts the attempts because, unlike a table, it is
    // not rolled back with the savepoint.
    await db.execute(sql`create sequence slug_race_attempts`);
    await db.execute(sql`
      create function slug_race() returns trigger as $$
      begin
        if new.slug = 'race-tool' and nextval('slug_race_attempts') = 1 then
          raise exception 'duplicate key value violates unique constraint "tools_slug_unique"'
            using errcode = '23505';
        end if;
        return new;
      end;
      $$ language plpgsql`);
    await db.execute(sql`create trigger slug_race before insert on tools for each row execute function slug_race()`);

    try {
      const created = await db.transaction(async (tx) => {
        const record = await createToolRecord(tx, { name: "Race Tool", published: true }, ACTOR);
        // A failed statement outside a savepoint would have aborted this.
        await tx.select().from(tools);
        return record;
      });
      expect(created.slug).toBe("race-tool");
      expect(await db.select().from(tools).where(eq(tools.id, created.toolId))).toHaveLength(1);
    } finally {
      await db.execute(sql`drop trigger slug_race on tools`);
      await db.execute(sql`drop function slug_race()`);
      await db.execute(sql`drop sequence slug_race_attempts`);
    }
  });

  it("creates the units and resources, and stamps the actor on every row", async () => {
    const created = await createToolRecord(
      db,
      {
        name: "  Prusa MK4S ",
        description: "  An FDM printer. ",
        materials: ["PLA", " ", "PETG "],
        ppeRequired: [],
        tags: ["3d-printing"],
        trainingRequired: true,
        useRestrictions: "",
        published: true,
        units: [
          { unitLabel: "Prusa MK4S #1", serialNumber: "SN-1" },
          { unitLabel: "Prusa MK4S #2", serialNumber: " ", status: "in_use", condition: "new" },
        ],
        resources: [
          { title: "Manual", url: "https://example.com/manual.pdf", type: "Manual" },
          { title: "Video", url: "https://example.com/video", type: "Video" },
        ],
      },
      ACTOR
    );

    const [row] = await db.select().from(tools).where(eq(tools.id, created.toolId));
    expect(row).toMatchObject({
      name: "Prusa MK4S",
      description: "An FDM printer.",
      materials: ["PLA", "PETG"],
      trainingRequired: true,
      useRestrictions: null,
      published: true,
      createdBy: ACTOR,
      updatedBy: ACTOR,
    });

    const unitRows = await db.select().from(units).where(eq(units.toolId, created.toolId));
    expect(created.unitIds).toHaveLength(2);
    expect(unitRows.map((unit) => [unit.id, unit.unitLabel, unit.serialNumber, unit.status, unit.condition]).sort()).toEqual(
      [
        [created.unitIds[0], "Prusa MK4S #1", "SN-1", "available", null],
        [created.unitIds[1], "Prusa MK4S #2", null, "in_use", "new"],
      ].sort()
    );
    expect(unitRows.every((unit) => unit.createdBy === ACTOR && unit.updatedBy === ACTOR)).toBe(true);

    const resourceRows = await db.select().from(resources).where(eq(resources.toolId, created.toolId));
    expect(created.resourceIds).toHaveLength(2);
    expect(resourceRows.map((resource) => resource.title).sort()).toEqual(["Manual", "Video"]);
    expect(resourceRows.every((resource) => resource.createdBy === ACTOR && resource.published)).toBe(true);
  });

  it("writes published as told, in both directions", async () => {
    const draft = await createToolRecord(db, { name: "Draft", published: false }, ACTOR);
    const live = await createToolRecord(db, { name: "Live", published: true }, null);
    const rows = await db.select({ id: tools.id, published: tools.published, createdBy: tools.createdBy }).from(tools);
    expect(rows.find((row) => row.id === draft.toolId)?.published).toBe(false);
    expect(rows.find((row) => row.id === live.toolId)).toMatchObject({ published: true, createdBy: null });
  });

  it("marks training required when the caller does not say, and none only when told (research amendment 2026-09-24)", async () => {
    const unsaid = await createToolRecord(db, { name: "Unsaid", published: false }, ACTOR);
    const none = await createToolRecord(db, { name: "No training", trainingRequired: false, published: false }, ACTOR);
    const rows = await db.select({ id: tools.id, trainingRequired: tools.trainingRequired }).from(tools);
    expect(rows.find((row) => row.id === unsaid.toolId)?.trainingRequired).toBe(true);
    expect(rows.find((row) => row.id === none.toolId)?.trainingRequired).toBe(false);
  });

  it("refuses a blank name before touching the database", async () => {
    await expect(createToolRecord(db, { name: "   ", published: false }, ACTOR)).rejects.toThrow(/name/);
    expect(await db.select().from(tools)).toHaveLength(0);
  });
});
