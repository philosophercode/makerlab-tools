// @vitest-environment node
import { createPgliteDb } from "../db/pglite";
import { categories, locations } from "../db/schema/index";
import type { Db } from "../db/types";
import {
  findOrCreateCategory,
  findOrCreateLocation,
  listCategories,
  listLocations,
} from "./taxonomy";

/**
 * The two option lists an editing surface needs.
 *
 * The ordering is the whole behaviour: a select whose first entries are the
 * ungrouped oddities reads as broken, which is why `nulls last` is asserted
 * rather than left to Postgres' default (nulls sort *first* on an ascending
 * order, so the default is exactly wrong here).
 */

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  await db.delete(categories);
  await db.delete(locations);
});

describe("listCategories", () => {
  it("orders by group then name, with ungrouped categories last", async () => {
    await db.insert(categories).values([
      { name: "Vinyl Cutting", group: null },
      { name: "Resin Printing", group: "3D Printing" },
      { name: "Laser Cutting", group: "Subtractive" },
      { name: "FDM Printing", group: "3D Printing" },
    ]);

    expect((await listCategories({ db })).map((option) => [option.group, option.name])).toEqual([
      ["3D Printing", "FDM Printing"],
      ["3D Printing", "Resin Printing"],
      ["Subtractive", "Laser Cutting"],
      [null, "Vinyl Cutting"],
    ]);
  });

  it("is empty on a workspace with no categories rather than throwing", async () => {
    expect(await listCategories({ db })).toEqual([]);
  });
});

describe("listLocations", () => {
  it("orders by room then zone and carries the map tag", async () => {
    await db.insert(locations).values([
      { room: "Bloomberg 061", zone: "Resin Bay", mapTag: "ML-RESIN-01" },
      { room: "Bloomberg 059", zone: "Laser Bay", mapTag: null },
      { room: "Bloomberg 061", zone: "Fabrication", mapTag: "ML-FAB-01" },
    ]);

    expect((await listLocations({ db })).map((option) => [option.room, option.zone])).toEqual([
      ["Bloomberg 059", "Laser Bay"],
      ["Bloomberg 061", "Fabrication"],
      ["Bloomberg 061", "Resin Bay"],
    ]);
    expect((await listLocations({ db }))[0].mapTag).toBeNull();
  });
});

describe("findOrCreateCategory", () => {
  it("finds an existing category case-insensitively, group included", async () => {
    const [existing] = await db
      .insert(categories)
      .values({ name: "FDM", group: "3D Printing" })
      .returning({ id: categories.id });

    expect(await findOrCreateCategory(db, { name: " fdm ", group: "3d printing" })).toEqual({
      id: existing.id,
      created: false,
    });
    expect(await db.select().from(categories)).toHaveLength(1);
  });

  it("creates one that is missing — and a null group is its own group", async () => {
    await db.insert(categories).values({ name: "Vinyl", group: "Cutting" });

    const created = await findOrCreateCategory(db, { name: "Vinyl", group: null });
    expect(created.created).toBe(true);
    const again = await findOrCreateCategory(db, { name: "vinyl", group: "  " });
    expect(again).toEqual({ id: created.id, created: false });
    expect(await db.select().from(categories)).toHaveLength(2);
  });

  it("runs inside a caller's transaction and rolls back with it", async () => {
    await expect(
      db.transaction(async (tx) => {
        const made = await findOrCreateCategory(tx, { name: "Temporary", group: null });
        expect(made.created).toBe(true);
        throw new Error("caller changed its mind");
      })
    ).rejects.toThrow("caller changed its mind");
    expect(await db.select().from(categories)).toHaveLength(0);
  });

  it("refuses a blank name", async () => {
    await expect(findOrCreateCategory(db, { name: "  ", group: null })).rejects.toThrow(/name/);
  });
});

describe("findOrCreateLocation", () => {
  it("finds an existing location case-insensitively, or creates it", async () => {
    const [existing] = await db
      .insert(locations)
      .values({ room: "MakerLab", zone: "Resin Bench" })
      .returning({ id: locations.id });

    expect(await findOrCreateLocation(db, { room: "makerlab", zone: "RESIN BENCH" })).toEqual({
      id: existing.id,
      created: false,
    });

    const created = await findOrCreateLocation(db, { room: "MakerLab", zone: "Laser Bay" });
    expect(created.created).toBe(true);
    expect(await db.select().from(locations)).toHaveLength(2);
  });

  it("refuses a blank room or zone", async () => {
    await expect(findOrCreateLocation(db, { room: "MakerLab", zone: " " })).rejects.toThrow();
  });
});
