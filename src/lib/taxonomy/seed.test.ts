// @vitest-environment node
import { createPgliteDb } from "../db/pglite";
import { categories } from "../db/schema";
import type { Db } from "../db/types";
import { ensureDefaultTaxonomy } from "./seed";
import { flattenTree } from "./tree";

/** The default tree on a lab with no categories (assistant cleanup spec 2026-10-28 §2). */

let db: Db;

beforeEach(async () => {
  db = await createPgliteDb();
});

describe("ensureDefaultTaxonomy", () => {
  it("writes the whole tree, parents first, on an empty table — and nothing the second time", async () => {
    const first = await ensureDefaultTaxonomy({ db });
    expect(first.inserted).toBe(flattenTree().length);
    const rows = await db.select().from(categories);
    const bySlug = new Map(rows.map((row) => [row.slug, row]));
    expect(bySlug.get("fdm-printers")?.parentId).toBe(bySlug.get("3d-printing")?.id);
    expect(bySlug.get("3d-printing")?.parentId).toBeNull();

    expect((await ensureDefaultTaxonomy({ db })).inserted).toBe(0);
    expect(await db.select().from(categories)).toHaveLength(rows.length);
  });

  it("never touches a lab that has any category, even a retired one", async () => {
    await db.insert(categories).values({ name: "Old", slug: "old", retiredAt: new Date() });
    expect((await ensureDefaultTaxonomy({ db })).inserted).toBe(0);
    expect(await db.select().from(categories)).toHaveLength(1);
  });
});
