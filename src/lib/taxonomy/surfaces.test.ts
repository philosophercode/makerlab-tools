// @vitest-environment node
import { nextCacheMock } from "../../../test/mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());

import { eq } from "drizzle-orm";
import { visibleInGallery } from "../../components/gallery-filters";
import { NO_FILTERS, matchesFilters } from "../../components/admin/inventory-filters";
import { catalog } from "../capabilities/catalog";
import type { CapabilityTool } from "../capabilities/types";
import { listCatalogTools } from "../data/catalog";
import { getDb, resetDbForTests } from "../db/client";
import { categories, tools } from "../db/schema/index";
import { absentOptionalProperties, validateDatabaseSchema, expectedProperties } from "../mirror/database-schemas";
import { categoryProperties } from "../mirror/properties";

/**
 * Taxonomy v2's knock-on changes (spec §4.9), against the demo seed's v2
 * tree: the catalogue takes its heading from the parent and carries the
 * gallery-hidden flag; the gallery leaves hidden categories out until the
 * Category facet names one; the assistant does the same for everybody but
 * staff; the inventory's category filter takes a top-level category; and the
 * Notion mirror's new category properties are optional, so an existing mirror
 * keeps pushing.
 */

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
});

afterAll(() => {
  resetDbForTests();
});

function tool(name: string): CapabilityTool {
  const found = catalog.tools.find((t) => t.name === name);
  if (!found) throw new Error(`No such tool: ${name}`);
  return found;
}

async function addHiddenTool(): Promise<void> {
  const db = await getDb();
  const [batteries] = await db.select().from(categories).where(eq(categories.slug, "batteries-chargers"));
  await db
    .insert(tools)
    .values({ slug: "ryobi-battery-v2test", name: "Ryobi Battery V2", categoryId: batteries.id, published: true })
    .onConflictDoNothing();
}

describe("the catalogue", () => {
  it("heads a tool with its parent category, its slug and the hidden flag; a single-level category is its own heading", async () => {
    await addHiddenTool();
    const all = await listCatalogTools({});
    const form4 = all.find((entry) => entry.slug === "form-4")!;
    expect(form4).toMatchObject({ category: "3D Printing", categorySub: "Resin Printers & Post-Processing", categorySlug: "resin-printers-post-processing", galleryHidden: false });
    const trotec = all.find((entry) => entry.slug === "trotec-speedy-400")!;
    expect(trotec).toMatchObject({ category: "Laser Cutting & Engraving", categorySub: "Laser Cutting & Engraving" });
    const battery = all.find((entry) => entry.slug === "ryobi-battery-v2test")!;
    expect(battery).toMatchObject({ category: "Shop Infrastructure & Supplies", categorySub: "Batteries & Chargers", galleryHidden: true });

    expect(visibleInGallery(all, { category: null }).map((entry) => entry.slug)).not.toContain("ryobi-battery-v2test");
    expect(visibleInGallery(all, { category: "Shop Infrastructure & Supplies" }).map((entry) => entry.slug)).toContain("ryobi-battery-v2test");
  });

  it("leaves hidden categories out of a student's search and list, unless asked for by category; staff see them", async () => {
    await addHiddenTool();
    const student = { identity: { role: "user", userId: "u1" } } as never;
    const staff = { identity: { role: "admin", userId: "u2" } } as never;
    const names = (result: unknown) => (result as { tools: { slug: string }[] }).tools.map((entry) => entry.slug);

    expect(names(await tool("search_tools").run({ query: "battery" }, student))).toEqual([]);
    expect(names(await tool("list_tools").run({}, student))).not.toContain("ryobi-battery-v2test");
    expect(names(await tool("list_tools").run({ category: "batteries" }, student))).toEqual(["ryobi-battery-v2test"]);
    expect(names(await tool("search_tools").run({ query: "battery" }, staff))).toEqual(["ryobi-battery-v2test"]);
  });
});

describe("the inventory filter", () => {
  it("takes a category or its top-level heading", () => {
    const rows = [
      { categoryName: "Sanders", categoryGroup: "Power Tools" },
      { categoryName: "Hand Saws", categoryGroup: "Hand Tools" },
    ];
    const filter = (category: string) => rows.filter((row) => matchesFilters(row as never, { ...NO_FILTERS, category }));
    expect(filter("Power Tools")).toEqual([rows[0]]);
    expect(filter("Hand Saws")).toEqual([rows[1]]);
  });
});

describe("the Notion mirror", () => {
  it("does not call a categories database without the new properties a mismatch, and leaves them out of its pages", () => {
    const properties: Record<string, { id: string; name: string; type: string }> = {};
    for (const expected of expectedProperties("categories", {})) {
      if (["Slug", "Description", "Retired"].includes(expected.name)) continue;
      properties[expected.name] = { id: expected.name, name: expected.name, type: expected.type };
    }
    const old = { object: "database" as const, id: "db", properties };
    expect(validateDatabaseSchema("categories", old as never, {})).toBeNull();
    expect(absentOptionalProperties("categories", old as never)).toEqual(["Slug", "Description", "Retired"]);

    // A wrong type is still a mismatch.
    const wrong = { ...old, properties: { ...properties, Slug: { id: "Slug", name: "Slug", type: "number" } } };
    expect(validateDatabaseSchema("categories", wrong as never, {})).toMatchObject({ code: "schema_mismatch", wrongType: ["Slug"] });
  });

  it("writes the heading, slug, description and retired flag", () => {
    const built = categoryProperties({
      id: "c1",
      updatedAt: new Date("2026-09-28T00:00:00Z"),
      revision: "1",
      pageId: null,
      archive: false,
      name: "Sanders",
      group: "Power Tools",
      slug: "sanders",
      description: "Orbital sanders.",
      retired: false,
    } as never);
    expect(JSON.stringify(built.properties.Group)).toContain("Power Tools");
    expect(JSON.stringify(built.properties.Slug)).toContain("sanders");
    expect(built.properties.Retired).toEqual({ checkbox: false });
  });
});
