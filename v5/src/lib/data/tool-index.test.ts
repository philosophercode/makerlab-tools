// @vitest-environment node
import { createPgliteDb } from "../db/pglite";
import { tools } from "../db/schema/index";
import type { Db } from "../db/types";
import { listToolIndex } from "./tool-index";

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb();
  await db.insert(tools).values([
    { name: "Bandsaw", slug: "bandsaw", published: true },
    { name: "Draft Lathe", slug: "draft-lathe", published: false },
    { name: "Old Drill", slug: "old-drill", published: false, archivedAt: new Date() },
  ]);
});

describe("listToolIndex", () => {
  it("lists published tools, or drafts too, never archived ones", async () => {
    expect((await listToolIndex({ includeDrafts: false, db })).map((t) => t.slug)).toEqual(["bandsaw"]);
    expect((await listToolIndex({ includeDrafts: true, db })).map((t) => t.slug)).toEqual(["bandsaw", "draft-lathe"]);
  });

  it("lists only the drafts for the admin palette, which adds them to the published list (quick win 12)", async () => {
    const drafts = await listToolIndex({ includeDrafts: true, draftsOnly: true, db });
    expect(drafts.map((t) => [t.slug, t.published])).toEqual([["draft-lathe", false]]);
  });
});
