// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { createPgliteDb } from "../db/pglite";
import { categories, tools } from "../db/schema";
import type { Db } from "../db/types";
import { moveFor, TOOL_MOVES } from "./mapping";
import { applyTaxonomyPlan, formatApplyReport, formatTaxonomyPlan, movesWithFacets, planIsEmpty, planTaxonomyMigration, readTaxonomySnapshot } from "./migrate";
import { flattenTree } from "./tree";

/**
 * The taxonomy v2 facets (`item_kind`, `parent_tool_id`) on a fixture shaped
 * like the live inventory: every slug the mapping names, in pre-v2 grouped
 * categories, under the names the 2026-09-28 inventory cleanup gave them.
 *
 * What went wrong on the owner's run: every facet rode along with its tool's
 * move and was counted under "tools moved", so the apply report said "0 facet
 * updates" while the facets were in fact written. These tests pin both the
 * writes and the report.
 */

const BUNDLE = resolve(__dirname, "../../../data/inventory-cleanup-2026-09-28");
const renames: { slug: string; from: string; to: string }[] = JSON.parse(readFileSync(resolve(BUNDLE, "renames.json"), "utf8")).tools;
const bundleSlugs = new Set<string>(
  (JSON.stringify(
    ["manuals.json", "renames.json", "starter-questions.json", "tags-remove.json", "urls-clean.json"].map((file) =>
      JSON.parse(readFileSync(resolve(BUNDLE, file), "utf8"))
    )
  ).match(/"(?:slug|toolSlug)":"[^"]+"/g) ?? []).map((pair) => pair.split(":")[1].replace(/"/g, ""))
);

/** The facets the owner asked for, by slug (tools not named are equipment, no parent). */
const EXPECTED: Record<string, [string, string | null]> = {
  "original-prusa-i3-mk3s-enclosure-bundle": ["accessory", "prusa-i3-mk3s"],
  "ultimaker-metal-expansion-kit": ["accessory", "ultimaker-s5"],
  "ultimaker-s5-air-manager": ["accessory", "ultimaker-s5"],
  "makita-plunge-base": ["accessory", "makita-rt0701c"],
  "apple-pencil": ["accessory", "ipad-6th-generation-mr7f2ll-a"],
  "tripod-with-adapter": ["accessory", null],
  "fulton-hose-ring-clamp": ["accessory", null],
  "peachtree-woodworking-supply-pvc-hose": ["accessory", null],
  "powertec-hose-coupler-70136": ["accessory", null],
  "dewalt-dcb107-12v-20v-max-lithium-ion-charger": ["accessory", null],
  "ryobi-p117-dual-chemistry-12v-18v-battery-charger-replacement": ["accessory", null],
  "ryobi-one-18v-lithium-ion-charger-pcg002": ["accessory", null],
  "ryobi-one-18v-lithium-ion-1-5-ah-battery-pbp002": ["accessory", null],
  "ryobi-one-18v-lithium-ion-3-0-ah-battery-p103": ["accessory", null],
  "ryobi-one-18v-lithium-ion-4-ah-battery-pbp004": ["accessory", null],
  "label-maker-ac-adapter": ["accessory", null],
  "dust-masks": ["consumable", null],
  "hercules-sanding-sheets": ["consumable", null],
  "suizan-replacement-blade": ["consumable", null],
  "festool-bench": ["fixture", null],
  "woodworking-tools-storage-bench": ["fixture", null],
  "plywood-stacking-rolling-cart": ["fixture", null],
  "valley-craft-a-frame-bin-cart": ["fixture", null],
  "nest-protect-smoke-and-co-alarm": ["fixture", null],
};

/** Every mapped slug in one pre-v2 category, named as before (or after) the cleanup. */
async function seedInventory(db: Db, names: "before" | "after") {
  const [old] = await db.insert(categories).values({ name: "Accessory", group: "Woodworking" }).returning({ id: categories.id });
  const byRename = new Map(renames.map((entry) => [entry.slug, entry]));
  for (const slug of Object.keys(TOOL_MOVES)) {
    const rename = byRename.get(slug);
    const name = rename ? (names === "after" ? rename.to : rename.from) : slug;
    await db.insert(tools).values({ slug, name, categoryId: old.id });
  }
}

/** Apply the cleanup's display-name renames, as `inventory:cleanup` does (by slug). */
async function applyRenames(db: Db) {
  for (const entry of renames) await db.update(tools).set({ name: entry.to }).where(eq(tools.slug, entry.slug));
}

async function facetsBySlug(db: Db): Promise<Record<string, [string, string | null]>> {
  const rows = await db.select({ id: tools.id, slug: tools.slug, itemKind: tools.itemKind, parentToolId: tools.parentToolId }).from(tools);
  const slugById = new Map(rows.map((row) => [row.id, row.slug]));
  return Object.fromEntries(
    rows
      .filter((row) => row.itemKind !== "equipment" || row.parentToolId)
      .map((row) => [row.slug, [row.itemKind, row.parentToolId ? slugById.get(row.parentToolId)! : null]])
  );
}

describe("taxonomy:migrate facets", () => {
  it("sets every facet by slug, whichever of the cleanup and the migration ran first", async () => {
    for (const order of ["cleanup-first", "migrate-first"] as const) {
      const db = await createPgliteDb();
      await seedInventory(db, "before");
      if (order === "cleanup-first") await applyRenames(db);

      const plan = planTaxonomyMigration(await readTaxonomySnapshot(db));
      expect(plan.unmapped).toEqual([]);
      const report = await applyTaxonomyPlan(db, plan);
      expect(report.moved).toBe(Object.keys(TOOL_MOVES).length);
      expect(report.movedWithFacets).toBe(Object.keys(EXPECTED).length);
      expect(report.facets).toBe(0);
      if (order === "migrate-first") await applyRenames(db);

      expect(await facetsBySlug(db)).toEqual(EXPECTED);
      expect(planIsEmpty(planTaxonomyMigration(await readTaxonomySnapshot(db)))).toBe(true);
    }
  });

  it("says the facets that rode with a move, rather than '0 facet updates'", async () => {
    const db = await createPgliteDb();
    await seedInventory(db, "after");
    const plan = planTaxonomyMigration(await readTaxonomySnapshot(db));
    expect(movesWithFacets(plan)).toBe(Object.keys(EXPECTED).length);
    const printed = formatTaxonomyPlan(plan).join("\n");
    expect(printed).toContain(`Facets: ${Object.keys(EXPECTED).length} set with a move, 0 on tools already placed.`);
    expect(printed).toContain("makita-plunge-base: Woodworking › Accessory → routers [slug] (kind accessory, accessory of makita-rt0701c)");

    const report = await applyTaxonomyPlan(db, plan);
    expect(formatApplyReport(report)).toBe(
      `Written: ${flattenTree().length} categories created, 0 updated, ${Object.keys(TOOL_MOVES).length} tools moved ` +
        `(${Object.keys(EXPECTED).length} with facets), 0 facet updates on tools already placed, 1 old categories retired.`
    );
  });

  it("fills facets still at the default on tools already placed, and never overwrites a chosen one", async () => {
    const db = await createPgliteDb();
    await seedInventory(db, "after");
    await applyTaxonomyPlan(db, planTaxonomyMigration(await readTaxonomySnapshot(db)));

    // An earlier run without facets: every tool placed, every facet at its default…
    await db.update(tools).set({ itemKind: "equipment", parentToolId: null });
    // …except one a person chose since.
    const [s5] = await db.select({ id: tools.id }).from(tools).where(eq(tools.slug, "ultimaker-s5"));
    await db.update(tools).set({ itemKind: "consumable", parentToolId: s5.id }).where(eq(tools.slug, "dust-masks"));

    const plan = planTaxonomyMigration(await readTaxonomySnapshot(db));
    expect(plan.moves).toEqual([]);
    const planned = Object.fromEntries(plan.facets.map((facet) => [facet.toolSlug, [facet.itemKind, facet.parentToolSlug]]));
    expect(planned["makita-plunge-base"]).toEqual(["accessory", "makita-rt0701c"]);
    expect(planned["ryobi-one-18v-lithium-ion-4-ah-battery-pbp004"]).toEqual(["accessory", null]);
    expect(planned["dust-masks"]).toBeUndefined();

    const report = await applyTaxonomyPlan(db, plan);
    expect(report.facets).toBe(plan.facets.length);
    expect(formatApplyReport(report)).toContain(`${plan.facets.length} facet updates on tools already placed`);
    const after = await facetsBySlug(db);
    expect(after["makita-plunge-base"]).toEqual(["accessory", "makita-rt0701c"]);
    expect(after["dust-masks"]).toEqual(["consumable", "ultimaker-s5"]);
    expect(planIsEmpty(planTaxonomyMigration(await readTaxonomySnapshot(db)))).toBe(true);
  });

  it("places the two hosted-only tools, and the three added after the review, by slug", async () => {
    const db = await createPgliteDb();
    const [old] = await db.insert(categories).values({ name: "Misc", group: "Other" }).returning({ id: categories.id });
    const added = ["apple-homepod-2nd-generation", "nest-protect-smoke-and-co-alarm", "creality-ender-3-v3-3d-printer", "glowforge-aura", "bofa-ad500-fume-extractor"];
    for (const slug of added) await db.insert(tools).values({ slug, name: slug, categoryId: old.id });
    const plan = planTaxonomyMigration(await readTaxonomySnapshot(db));
    expect(plan.unmapped).toEqual([]);
    expect(Object.fromEntries(plan.moves.map((move) => [move.toolSlug, [move.to, move.itemKind]]))).toEqual({
      "apple-homepod-2nd-generation": ["cameras-mounts", null],
      "nest-protect-smoke-and-co-alarm": ["ppe", "fixture"],
      "creality-ender-3-v3-3d-printer": ["fdm-printers", null],
      "glowforge-aura": ["laser-cutting-engraving", null],
      "bofa-ad500-fume-extractor": ["dust-collection", null],
    });
    await applyTaxonomyPlan(db, plan);
    const rows = await db.select({ slug: tools.slug, itemKind: tools.itemKind }).from(tools).where(inArray(tools.slug, added));
    expect(rows.find((row) => row.slug === "nest-protect-smoke-and-co-alarm")?.itemKind).toBe("fixture");
  });
});

describe("the facet mapping", () => {
  it("names every tool in the cleanup bundle by slug", () => {
    expect([...bundleSlugs].filter((slug) => !(slug in TOOL_MOVES))).toEqual([]);
  });

  it("gives a parent only to accessories, and only parents that are equipment", () => {
    for (const [slug, move] of Object.entries(TOOL_MOVES)) {
      if (!move.parentSlug) continue;
      expect([slug, move.itemKind]).toEqual([slug, "accessory"]);
      expect([slug, TOOL_MOVES[move.parentSlug].itemKind]).toEqual([slug, undefined]);
    }
  });

  it("leaves the Ryobi ONE+ batteries and chargers without a single parent", () => {
    const ryobiPower = Object.entries(TOOL_MOVES).filter(([slug]) => /^ryobi-.*(battery|charger)/.test(slug));
    expect(ryobiPower.length).toBe(5);
    for (const [, move] of ryobiPower) expect(move).toEqual({ category: "batteries-chargers", itemKind: "accessory" });
  });

  it("matches the facet table the spec amendment lists", () => {
    const fromMapping = Object.fromEntries(
      Object.entries(TOOL_MOVES)
        .filter(([, move]) => move.itemKind)
        .map(([slug, move]) => [slug, [move.itemKind, move.parentSlug ?? null]])
    );
    expect(fromMapping).toEqual(EXPECTED);
    expect(moveFor({ slug: "apple-homepod-2nd-generation", name: "HomePod", categoryName: null, categoryGroup: null })?.move).toEqual({ category: "cameras-mounts" });
  });
});
