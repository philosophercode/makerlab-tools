// @vitest-environment node
import { eq, sql } from "drizzle-orm";
import { expectViolation } from "../../../../test/db";
import { createPgliteDb } from "../pglite";
import { rawRows } from "../raw";
import { user } from "./auth";
import { pendingTools } from "./pending-tools";
import { tools } from "./tools";
import type { Db } from "../types";

/**
 * Migration `0005` against a real (in-process) Postgres (spec §4.10).
 *
 * Every assertion here is a thing that only fails at runtime: a CHECK that
 * lets a misspelt status through, a trigger that never fires, a foreign key
 * that deletes when it should null. The schema file cannot show any of them.
 */
describe("pending_tools", () => {
  let db: Db;

  beforeAll(async () => {
    db = await createPgliteDb();
  });

  async function insertUser(): Promise<string> {
    const id = `u-${Math.random().toString(36).slice(2)}`;
    await db.insert(user).values({ id, name: "Test Person", email: `${id}@cornell.edu` });
    return id;
  }

  function pendingRow(createdBy: string, overrides: Partial<typeof pendingTools.$inferInsert> = {}) {
    return {
      batchId: crypto.randomUUID(),
      name: "Bambu Lab X1-Carbon",
      createdBy,
      ...overrides,
    };
  }

  it("starts identified and refuses a status outside the vocabulary", async () => {
    const owner = await insertUser();
    const [row] = await db.insert(pendingTools).values(pendingRow(owner)).returning();
    expect(row.status).toBe("identified");

    await expectViolation(
      db.insert(pendingTools).values(pendingRow(owner, { status: "Researched" })),
      /pending_tools_status_check/
    );
  });

  it("refuses a duplicate resolution outside the vocabulary and accepts null", async () => {
    const owner = await insertUser();
    await expectViolation(
      db.insert(pendingTools).values(pendingRow(owner, { duplicateResolution: "merge" })),
      /pending_tools_duplicate_resolution_check/
    );
    await expect(
      db.insert(pendingTools).values([
        pendingRow(owner, { duplicateResolution: null }),
        pendingRow(owner, { duplicateResolution: "add_unit" }),
      ])
    ).resolves.toBeDefined();
  });

  it("maintains updated_at from the trigger", async () => {
    const owner = await insertUser();
    const [row] = await db.insert(pendingTools).values(pendingRow(owner)).returning();

    await new Promise((resolve) => setTimeout(resolve, 5));
    await db.update(pendingTools).set({ brand: "Bambu Lab" }).where(eq(pendingTools.id, row.id));

    const [after] = await db.select().from(pendingTools).where(eq(pendingTools.id, row.id));
    expect(after.updatedAt.getTime()).toBeGreaterThan(row.updatedAt.getTime());

    const triggers = await rawRows<{ tgname: string }>(
      db,
      sql`select tgname from pg_trigger where tgname = 'pending_tools_set_updated_at'`
    );
    expect(triggers).toHaveLength(1);
  });

  it("refuses an owner that names no account", async () => {
    await expectViolation(
      db.insert(pendingTools).values(pendingRow("no-such-user")),
      /pending_tools_created_by_user_id_fk/
    );
  });

  it("keeps a person's pending rows when their account goes, owner cleared (migration 0016)", async () => {
    // It used to cascade ("a pending item always has an owner"). Removing a
    // person must not delete what they identified — approved items included —
    // so the owner is `set null` like every other actor column (auth spec
    // amendment 2026-09-25), and anyone holding `tools.approve` works it.
    const owner = await insertUser();
    const reviewer = await insertUser();
    const [row] = await db
      .insert(pendingTools)
      .values(pendingRow(owner, { researchRequestedBy: reviewer }))
      .returning();
    const [kept] = await db
      .insert(pendingTools)
      .values(pendingRow(reviewer, { researchRequestedBy: owner }))
      .returning();

    await db.delete(user).where(eq(user.id, owner));

    const [orphan] = await db.select().from(pendingTools).where(eq(pendingTools.id, row.id));
    expect(orphan.createdBy).toBeNull();
    expect(orphan.researchRequestedBy).toBe(reviewer);
    // Somebody else's row the departed person merely touched survives, nulled.
    const [survivor] = await db.select().from(pendingTools).where(eq(pendingTools.id, kept.id));
    expect(survivor.researchRequestedBy).toBeNull();
  });

  it("nulls the duplicate match when the matched tool is deleted", async () => {
    const owner = await insertUser();
    const [tool] = await db
      .insert(tools)
      .values({ slug: `dup-${crypto.randomUUID()}`, name: "Bambu Lab X1-Carbon" })
      .returning({ id: tools.id });
    const [row] = await db
      .insert(pendingTools)
      .values(pendingRow(owner, { duplicateOfToolId: tool.id }))
      .returning();

    await db.delete(tools).where(eq(tools.id, tool.id));

    const [after] = await db.select().from(pendingTools).where(eq(pendingTools.id, row.id));
    expect(after).toBeDefined();
    expect(after.duplicateOfToolId).toBeNull();
  });

  it("builds the trigram index on name that the duplicate check reads", async () => {
    const idx = await rawRows<{ indexname: string }>(
      db,
      sql`select indexname from pg_indexes where tablename = 'pending_tools' and indexname = 'pending_tools_name_trgm_idx'`
    );
    expect(idx).toHaveLength(1);
  });
});
