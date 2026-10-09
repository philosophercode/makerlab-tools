// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { migrationsFolder } from "../migrations-folder";
import { createPgliteDb } from "../pglite";
import { rawRows } from "../raw";
import { expectViolation } from "../../../../test/db";
import { starterAnswers } from "./starter-answers";
import { tools } from "./tools";

/**
 * Migration `0026` (starter answers): the `starter_answers` table. It is
 * numbered after PR #121's `0025` and applied by the journal's timestamps, so
 * its entry must come after every other.
 */

describe("migration 0026 — starter_answers", () => {
  it("is in the journal at 26, after 0025's timestamp and before every later migration's", () => {
    const journal = JSON.parse(readFileSync(join(migrationsFolder(), "meta", "_journal.json"), "utf8")) as {
      entries: { idx: number; when: number; tag: string }[];
    };
    const at = journal.entries.findIndex((entry) => entry.tag === "0026_starter_answers");
    expect(at).toBeGreaterThanOrEqual(0);
    const entry = journal.entries[at];
    expect(entry.idx).toBe(26);
    // PR #121's 0025_multi_item_intake: 1790655200848.
    expect(entry.when).toBeGreaterThan(1790655200848);
    for (const before of journal.entries.slice(0, at)) expect(before.when).toBeLessThan(entry.when);
    for (const after of journal.entries.slice(at + 1)) expect(after.when).toBeGreaterThan(entry.when);
  });

  it("creates the table with its columns, its chip key and its tool index", async () => {
    const db = await createPgliteDb();
    const columns = await rawRows<{ column_name: string; is_nullable: string }>(
      db,
      sql`select column_name, is_nullable from information_schema.columns where table_name = 'starter_answers' order by ordinal_position`
    );
    expect(columns.map((c) => c.column_name)).toEqual([
      "id",
      "tool_id",
      "locale",
      "question",
      "message",
      "model",
      "accepted",
      "grade",
      "usage_events",
      "source_hash",
      "created_at",
      "updated_at",
    ]);
    expect(columns.find((c) => c.column_name === "tool_id")?.is_nullable).toBe("YES");
    const indexes = await rawRows<{ indexname: string }>(db, sql`select indexname from pg_indexes where tablename = 'starter_answers'`);
    expect(indexes.map((i) => i.indexname)).toEqual(expect.arrayContaining(["starter_answers_chip_key", "starter_answers_tool_idx"]));
  });

  it("refuses a second answer to the same general chip (nulls not distinct) and cascades with its tool", async () => {
    const db = await createPgliteDb();
    const row = { locale: "en", question: "Q?", message: {}, model: "m", accepted: true, grade: {}, sourceHash: "h" };
    await db.insert(starterAnswers).values({ ...row, toolId: null });
    await expectViolation(db.insert(starterAnswers).values({ ...row, toolId: null }), /starter_answers_chip_key/);

    const [tool] = await db.insert(tools).values({ slug: "t", name: "T" }).returning({ id: tools.id });
    await db.insert(starterAnswers).values({ ...row, toolId: tool.id });
    await db.delete(tools).where(sql`${tools.id} = ${tool.id}`);
    const left = await db.select().from(starterAnswers);
    expect(left.map((r) => r.toolId)).toEqual([null]);
  });
});
