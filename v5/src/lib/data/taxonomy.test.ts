// @vitest-environment node
import { createPgliteDb } from "../db/pglite";
import { categories, locations } from "../db/schema/index";
import type { Db } from "../db/types";
import { listCategories, listLocations } from "./taxonomy";

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
