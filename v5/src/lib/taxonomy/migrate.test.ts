// @vitest-environment node
import { eq, isNull } from "drizzle-orm";
import { createPgliteDb } from "../db/pglite";
import { categories, tools } from "../db/schema";
import type { Db } from "../db/types";
import { parseMigrateArgs } from "../../../scripts/taxonomy-migrate";
import { moveFor, TOOL_MOVES } from "./mapping";
import { applyTaxonomyPlan, formatTaxonomyPlan, planIsEmpty, planTaxonomyMigration, readTaxonomySnapshot } from "./migrate";
import { flattenTree, TAXONOMY_TREE } from "./tree";

/**
 * `taxonomy:migrate` on a fixture database shaped like the live inventory
 * before v2: grouped categories from the Notion import, tools in them, and
 * the odd cases — a tool no rule places, a pre-v2 row holding a tree slug, a
 * tool somebody already placed.
 */

async function seed(db: Db) {
  const insertCategory = async (name: string, group: string) =>
    (await db.insert(categories).values({ name, group }).returning({ id: categories.id }))[0].id;
  const fdm = await insertCategory("FDM Printer", "3D Printing");
  const accessory3d = await insertCategory("Accessory", "3D Printing");
  const general = await insertCategory("General Hand Tool", "Woodworking");
  const accessoryWood = await insertCategory("Accessory", "Woodworking");
  const clash = (await db.insert(categories).values({ name: "Waterjet", group: "Old Shop", slug: "waterjet" }).returning())[0].id;
  const emptyOld = await insertCategory("Measuring", "Woodworking");
  const tool = async (slug: string, name: string, categoryId: string | null) =>
    (await db.insert(tools).values({ slug, name, categoryId }).returning({ id: tools.id }))[0].id;
  await tool("ultimaker-s5", "Ultimaker S5", fdm);
  await tool("ultimaker-s5-air-manager", "Ultimaker S5 Air Manager", accessory3d);
  await tool("new-printer", "Creality Ender", fdm);
  await tool("dremel-3000", "Dremel 3000", general);
  await tool("mystery-gadget", "Mystery Gadget", general);
  await tool("ryobi-impact-driver", "Ryobi Impact Driver", accessoryWood);
  await tool("suizan-replacement-blade", "Suizan Replacement Blade", accessoryWood);
  await tool("wazer-waterjet-pro", "WAZER", clash);
  return { fdm, accessory3d, general, accessoryWood, clash, emptyOld };
}

describe("taxonomy:migrate", () => {
  it("parses --apply, defaults to a dry run, and refuses anything else", () => {
    expect(parseMigrateArgs([])).toEqual({ apply: false });
    expect(parseMigrateArgs(["--apply"])).toEqual({ apply: true });
    expect(parseMigrateArgs(["--dry-run"])).toEqual({ apply: false });
    expect(() => parseMigrateArgs(["--force"])).toThrow(/Unknown argument/);
  });

  it("plans the whole tree, every move by its rule, and the empties to retire — without writing", async () => {
    const db = await createPgliteDb();
    const ids = await seed(db);
    const plan = planTaxonomyMigration(await readTaxonomySnapshot(db));

    expect(plan.categories.filter((category) => category.action === "create")).toHaveLength(flattenTree().length);
    expect(plan.legacySlugRenames).toEqual([{ categoryId: ids.clash, from: "waterjet", to: "waterjet-legacy" }]);
    const moves = Object.fromEntries(plan.moves.map((move) => [move.toolSlug, [move.to, move.rule, move.itemKind, move.parentToolSlug]]));
    expect(moves).toEqual({
      "ultimaker-s5": ["fdm-printers", "slug", null, null],
      "ultimaker-s5-air-manager": ["printer-upgrades", "slug", "accessory", "ultimaker-s5"],
      "new-printer": ["fdm-printers", "old_category", null, null],
      "dremel-3000": ["rotary-tools", "slug", null, null],
      "ryobi-impact-driver": ["drills-drivers", "name", null, null],
      "suizan-replacement-blade": ["consumables", "slug", "consumable", null],
      "wazer-waterjet-pro": ["waterjet", "slug", null, null],
    });
    expect(plan.unmapped).toEqual([{ toolSlug: "mystery-gadget", toolName: "Mystery Gadget", from: "Woodworking › General Hand Tool" }]);
    // General Hand Tool keeps the unmapped tool, so it stays; the rest empty out.
    const retired = Object.fromEntries(plan.retirements.map((entry) => [entry.label, entry.mergedIntoSlug]));
    expect(retired).toEqual({
      "3D Printing › Accessory": "printer-upgrades",
      "3D Printing › FDM Printer": "fdm-printers",
      "Old Shop › Waterjet": "waterjet",
      "Woodworking › Accessory": "consumables",
      "Woodworking › Measuring": null,
    });

    // A plan is only a plan.
    const [still] = await db.select().from(categories).where(eq(categories.id, ids.fdm));
    expect(still.retiredAt).toBeNull();
    expect(formatTaxonomyPlan(plan).join("\n")).toContain("ultimaker-s5-air-manager: 3D Printing › Accessory → printer-upgrades [slug] (kind accessory, accessory of ultimaker-s5)");
  });

  it("applies the plan, and a second run has nothing to do", async () => {
    const db = await createPgliteDb();
    const ids = await seed(db);
    const report = await applyTaxonomyPlan(db, planTaxonomyMigration(await readTaxonomySnapshot(db)));
    expect(report).toMatchObject({ created: flattenTree().length, moved: 7, retired: 5 });

    const rows = await db.select().from(categories);
    const bySlug = new Map(rows.map((row) => [row.slug, row]));
    const shop = bySlug.get("shop-infrastructure-supplies")!;
    expect(shop.galleryHidden).toBe(true);
    expect(shop.parentId).toBeNull();
    expect(bySlug.get("dust-collection")!.parentId).toBe(shop.id);
    expect(bySlug.get("waterjet")!.group).toBeNull();
    expect(bySlug.get("waterjet-legacy")!.id).toBe(ids.clash);
    expect(bySlug.get("waterjet-legacy")!.mergedIntoId).toBe(bySlug.get("waterjet")!.id);
    expect(bySlug.get("woodworking-general-hand-tool")!.retiredAt).toBeNull();

    const [air] = await db.select().from(tools).where(eq(tools.slug, "ultimaker-s5-air-manager"));
    const [s5] = await db.select().from(tools).where(eq(tools.slug, "ultimaker-s5"));
    expect(air.categoryId).toBe(bySlug.get("printer-upgrades")!.id);
    expect(air.itemKind).toBe("accessory");
    expect(air.parentToolId).toBe(s5.id);

    const again = planTaxonomyMigration(await readTaxonomySnapshot(db));
    expect(planIsEmpty(again)).toBe(true);
    expect(again.unmapped.map((tool) => tool.toolSlug)).toEqual(["mystery-gadget"]);
  });

  it("never moves a tool somebody already placed in the tree, nor overwrites a chosen facet", async () => {
    const db = await createPgliteDb();
    await seed(db);
    await applyTaxonomyPlan(db, planTaxonomyMigration(await readTaxonomySnapshot(db)));
    const [sanders] = await db.select().from(categories).where(eq(categories.slug, "sanders"));
    await db.update(tools).set({ categoryId: sanders.id, itemKind: "fixture" }).where(eq(tools.slug, "dremel-3000"));
    await db.update(categories).set({ description: "Ours now" }).where(eq(categories.slug, "sanders"));

    const plan = planTaxonomyMigration(await readTaxonomySnapshot(db));
    expect(planIsEmpty(plan)).toBe(true);
    const [dremel] = await db.select().from(tools).where(eq(tools.slug, "dremel-3000"));
    expect(dremel.categoryId).toBe(sanders.id);
    const [kept] = await db.select().from(categories).where(eq(categories.slug, "sanders"));
    expect(kept.description).toBe("Ours now");
  });

  it("refills only a blank description on a tree category that already exists", async () => {
    const db = await createPgliteDb();
    await db.insert(categories).values({ name: "Electronics", slug: "electronics", description: "" });
    const plan = planTaxonomyMigration(await readTaxonomySnapshot(db));
    const electronics = plan.categories.find((category) => category.slug === "electronics")!;
    expect(electronics.action).toBe("update");
    expect(electronics.changes).toContain("description");
    await applyTaxonomyPlan(db, plan);
    const top = await db.select().from(categories).where(isNull(categories.parentId));
    expect(top.map((row) => row.slug).sort()).toEqual(TAXONOMY_TREE.map((node) => node.slug).sort());
  });
});

describe("the mapping", () => {
  const treeSlugs = new Set(flattenTree().map((node) => node.slug));

  it("sends every listed tool to a category that is in the tree", () => {
    const missing = Object.entries(TOOL_MOVES).filter(([, move]) => !treeSlugs.has(move.category));
    expect(missing).toEqual([]);
  });

  it("names parents that are themselves listed tools", () => {
    const parents = Object.values(TOOL_MOVES).map((move) => move.parentSlug).filter(Boolean);
    expect(parents.filter((slug) => !(slug! in TOOL_MOVES))).toEqual([]);
  });

  it("has no default for the one old category the review splits tool by tool", () => {
    expect(moveFor({ slug: "x", name: "Mystery", categoryName: "General Hand Tool", categoryGroup: "Woodworking" })).toBeNull();
    expect(moveFor({ slug: "x", name: "Mystery", categoryName: " hand  saw ", categoryGroup: "WOODWORKING" })).toEqual({
      move: { category: "hand-saws" },
      rule: "old_category",
    });
  });

  it("gives every tree node a description and unique slug", () => {
    const flat = flattenTree();
    expect(new Set(flat.map((node) => node.slug)).size).toBe(flat.length);
    expect(flat.filter((node) => node.description.trim().length < 20)).toEqual([]);
    expect(TAXONOMY_TREE).toHaveLength(9);
  });
});
