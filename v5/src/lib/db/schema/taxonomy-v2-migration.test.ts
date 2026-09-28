// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { expectViolation } from "../../../../test/db";
import { migrationsFolder } from "../migrations-folder";
import { createPgliteDb } from "../pglite";
import { categories, categoryProposals } from "./taxonomy";
import { tools } from "./tools";

/**
 * Migration `0023` (taxonomy v2): slugs, the tree columns, category proposals
 * and the two tool facets. The slug backfill is run **as read from the
 * migration file** against rows shaped the way they looked before, as the
 * `0016` and `0018` tests do.
 */

function backfill(): string {
  const file = readFileSync(join(migrationsFolder(), "0023_taxonomy_v2.sql"), "utf8");
  const statement = file
    .split("--> statement-breakpoint")
    .map((part) => part.trim())
    .find((part) => part.startsWith('UPDATE "categories"'));
  expect(statement).toBeDefined();
  return statement as string;
}

describe("migration 0023 — taxonomy v2", () => {
  it("gives a category inserted without a slug one from its group and name", async () => {
    const db = await createPgliteDb();
    const [row] = await db.insert(categories).values({ name: "FDM Printer", group: "3D Printing" }).returning();
    expect(row.slug).toBe("3d-printing-fdm-printer");
    const [top] = await db.insert(categories).values({ name: "Laser Cutting & Engraving" }).returning();
    expect(top.slug).toBe("laser-cutting-engraving");
  });

  it("numbers a slug that would collide", async () => {
    const db = await createPgliteDb();
    await db.insert(categories).values({ name: "Accessory", slug: "accessory" });
    const [second] = await db.insert(categories).values({ name: "Accessory!", group: null }).returning();
    expect(second.slug).toBe("accessory-2");
  });

  it("keeps an explicit slug, and refuses a duplicate one", async () => {
    const db = await createPgliteDb();
    const [row] = await db.insert(categories).values({ name: "Hand Saws", slug: "hand-saws" }).returning();
    expect(row.slug).toBe("hand-saws");
    await expectViolation(db.insert(categories).values({ name: "Saws", slug: "hand-saws" }), /categories_slug_key/);
  });

  it("allows one name under two parents, but not twice under one", async () => {
    const db = await createPgliteDb();
    const [a] = await db.insert(categories).values({ name: "Electronics", slug: "electronics" }).returning();
    const [b] = await db.insert(categories).values({ name: "Scanning", slug: "scanning" }).returning();
    await db.insert(categories).values({ name: "Workstation", slug: "e-ws", parentId: a.id });
    await expect(db.insert(categories).values({ name: "Workstation", slug: "s-ws", parentId: b.id })).resolves.toBeDefined();
    await expectViolation(
      db.insert(categories).values({ name: "workstation", slug: "e-ws-2", parentId: a.id }),
      /categories_name_group_parent_key/
    );
  });

  it("backfills existing rows, numbering the second of two identical bases", async () => {
    const db = await createPgliteDb();
    await db.insert(categories).values([
      { name: "3D Scanner", group: "3D Printing", slug: "x1", createdAt: new Date("2026-01-01") },
      { name: "3D Scanner", group: "Scanning & VR", slug: "x2", createdAt: new Date("2026-01-02") },
      { name: "3D-Scanner", group: "3D Printing", slug: "x3", createdAt: new Date("2026-01-03") },
    ]);
    await db.execute(sql.raw(backfill()));
    const rows = await db.select({ name: categories.name, group: categories.group, slug: categories.slug }).from(categories);
    const slugs = Object.fromEntries(rows.map((row) => [`${row.group} › ${row.name}`, row.slug]));
    expect(slugs["3D Printing › 3D Scanner"]).toBe("3d-printing-3d-scanner");
    expect(slugs["3D Printing › 3D-Scanner"]).toBe("3d-printing-3d-scanner-2");
    expect(slugs["Scanning & VR › 3D Scanner"]).toBe("scanning-vr-3d-scanner");
  });

  it("restricts item_kind to the vocabulary, defaulting to equipment", async () => {
    const db = await createPgliteDb();
    const [router] = await db.insert(tools).values({ slug: "router", name: "Router" }).returning();
    expect(router.itemKind).toBe("equipment");
    const [base] = await db
      .insert(tools)
      .values({ slug: "plunge-base", name: "Plunge Base", itemKind: "accessory", parentToolId: router.id })
      .returning();
    expect(base.parentToolId).toBe(router.id);
    await expectViolation(db.insert(tools).values({ slug: "x", name: "X", itemKind: "gadget" }), /tools_item_kind_check/);
  });

  it("stores a category proposal and checks its vocabularies", async () => {
    const db = await createPgliteDb();
    const [parent] = await db.insert(categories).values({ name: "Power Tools", slug: "power-tools" }).returning();
    const [row] = await db
      .insert(categoryProposals)
      .values({ name: "Oscillating Tools", parentId: parent.id, source: "research", reason: "No fit" })
      .returning();
    expect(row.status).toBe("pending");
    expect(row.kind).toBe("new_category");
    await expectViolation(db.insert(categoryProposals).values({ name: "X", source: "somewhere" }), /category_proposals_source_check/);
    await expectViolation(
      db.insert(categoryProposals).values({ name: "X", source: "gui", status: "maybe" }),
      /category_proposals_status_check/
    );
    // A parent going away leaves the proposal, not a dangling id.
    await db.delete(categories).where(eq(categories.id, parent.id));
    const [after] = await db.select().from(categoryProposals).where(eq(categoryProposals.id, row.id));
    expect(after.parentId).toBeNull();
  });
});
