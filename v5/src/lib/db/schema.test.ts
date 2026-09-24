// @vitest-environment node
import { eq, sql } from "drizzle-orm";
import { expectViolation } from "../../../test/db";
import { createPgliteDb } from "./pglite";
import { rawRows } from "./raw";
import { categories, locations, maintenanceLogs, tools, units } from "./schema/index";
import type { Db } from "./types";

/**
 * The committed migrations, applied to a real (in-process) Postgres. These
 * are the tests that catch a schema mistake before it reaches Neon: every
 * CHECK, unique index and trigger the spec names is exercised here.
 */
describe("schema migrations on PGlite", () => {
  let db: Db;

  beforeAll(async () => {
    db = await createPgliteDb();
  });

  it("applies every migration and creates the tables", async () => {
    const rows = await rawRows<{ table_name: string }>(
      db,
      sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`
    );
    expect(rows.map((row) => row.table_name)).toEqual(
      expect.arrayContaining([
        "categories",
        "locations",
        "tools",
        "units",
        "resources",
        "attachments",
        "maintenance_logs",
        "feedback",
        "projects",
        "project_tools",
        "audit_events",
        "pending_tools",
      ])
    );
  });

  it("enables pg_trgm and builds the trigram index on tools.name", async () => {
    const ext = await rawRows<{ extname: string }>(
      db,
      sql`select extname from pg_extension where extname = 'pg_trgm'`
    );
    expect(ext).toHaveLength(1);
    const idx = await rawRows<{ indexname: string }>(
      db,
      sql`select indexname from pg_indexes where tablename = 'tools' and indexname = 'tools_name_trgm_idx'`
    );
    expect(idx).toHaveLength(1);
  });

  it("maintains updated_at from a trigger, not the ORM", async () => {
    const [row] = await db
      .insert(categories)
      .values({ name: "Trigger check", group: "Test" })
      .returning({ id: categories.id, updatedAt: categories.updatedAt });

    await new Promise((resolve) => setTimeout(resolve, 5));
    await db.update(categories).set({ name: "Trigger check 2" }).where(eq(categories.id, row.id));

    const [after] = await db
      .select({ updatedAt: categories.updatedAt })
      .from(categories)
      .where(eq(categories.id, row.id));
    expect(after.updatedAt.getTime()).toBeGreaterThan(row.updatedAt.getTime());
  });

  it("refuses a unit status outside the vocabulary", async () => {
    await expectViolation(
      db.insert(units).values({ unitLabel: "Bad", status: "Available" }),
      /units_status_check/
    );
  });

  it("accepts a null condition (unknown is honest) and the New option", async () => {
    await expect(
      db.insert(units).values([
        { unitLabel: "Unknown condition", condition: null },
        { unitLabel: "Brand new", condition: "new" },
      ])
    ).resolves.toBeDefined();
  });

  it("refuses a maintenance status outside the vocabulary but allows closed", async () => {
    await expectViolation(
      db.insert(maintenanceLogs).values({ title: "t", status: "Open" }),
      /maintenance_logs_status_check/
    );
    await expect(
      db.insert(maintenanceLogs).values({ title: "t", status: "closed" })
    ).resolves.toBeDefined();
  });

  it("keeps categories unique per (name, group) case-insensitively, and allows the same name in another group", async () => {
    await db.insert(categories).values({ name: "Other", group: "Electronics" });
    await expectViolation(
      db.insert(categories).values({ name: "other", group: "electronics" }),
      /categories_name_group_key/
    );
    await expect(
      db.insert(categories).values({ name: "Other", group: "Textiles" })
    ).resolves.toBeDefined();
  });

  it("keeps locations unique per (room, zone) and map tags unique when present", async () => {
    await db.insert(locations).values({ room: "MakerLab", zone: "Bench 1", mapTag: "ML-01" });
    await expectViolation(
      db.insert(locations).values({ room: "makerlab", zone: "bench 1" }),
      /locations_room_zone_key/
    );
    await expectViolation(
      db.insert(locations).values({ room: "MakerLab", zone: "Bench 2", mapTag: "ML-01" }),
      /locations_map_tag_unique/
    );
    await expect(
      db.insert(locations).values([
        { room: "MakerLab", zone: "Bench 3" },
        { room: "MakerLab", zone: "Bench 4" },
      ])
    ).resolves.toBeDefined();
  });

  it("keeps serial numbers unique per tool, case-insensitively, and ignores nulls", async () => {
    const [tool] = await db
      .insert(tools)
      .values({ slug: "serial-test", name: "Serial test" })
      .returning({ id: tools.id });
    await db.insert(units).values({ toolId: tool.id, unitLabel: "A", serialNumber: "SN-1" });
    await expectViolation(
      db.insert(units).values({ toolId: tool.id, unitLabel: "B", serialNumber: "sn-1" }),
      /units_tool_serial_key/
    );
    await expect(
      db.insert(units).values([
        { toolId: tool.id, unitLabel: "C" },
        { toolId: tool.id, unitLabel: "D" },
      ])
    ).resolves.toBeDefined();
  });

  it("cascades units when a tool row is deleted, and nulls the tool on a category delete", async () => {
    const [cat] = await db
      .insert(categories)
      .values({ name: "Cascade", group: "Test" })
      .returning({ id: categories.id });
    const [tool] = await db
      .insert(tools)
      .values({ slug: "cascade-test", name: "Cascade test", categoryId: cat.id })
      .returning({ id: tools.id });
    await db.insert(units).values({ toolId: tool.id, unitLabel: "X" });

    await db.delete(categories).where(eq(categories.id, cat.id));
    const [afterCat] = await db.select({ categoryId: tools.categoryId }).from(tools).where(eq(tools.id, tool.id));
    expect(afterCat.categoryId).toBeNull();

    await db.delete(tools).where(eq(tools.id, tool.id));
    const orphans = await db.select().from(units).where(eq(units.toolId, tool.id));
    expect(orphans).toHaveLength(0);
  });
});
