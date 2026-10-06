// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { migrationsFolder } from "../migrations-folder";
import { createPgliteDb } from "../pglite";
import { rawRows } from "../raw";

/**
 * Migration `0027` (recurring maintenance v1, spec amendment 2026-10-06): the
 * `maintenance_schedules` and `maintenance_completions` tables, their indexes
 * and the `updated_at` trigger. The behaviour is `data/maintenance-schedules.test.ts`;
 * this pins the shape and the journal order.
 */

describe("migration 0027 — recurring maintenance", () => {
  it("is the journal's entry 27, after every earlier migration", () => {
    const journal = JSON.parse(readFileSync(join(migrationsFolder(), "meta", "_journal.json"), "utf8")) as {
      entries: { idx: number; when: number; tag: string }[];
    };
    const at = journal.entries.findIndex((entry) => entry.tag === "0027_recurring_maintenance");
    expect(at).toBeGreaterThanOrEqual(0);
    const entry = journal.entries[at];
    expect(entry.idx).toBe(27);
    for (const before of journal.entries.slice(0, at)) expect(before.when).toBeLessThan(entry.when);
  });

  it("creates both tables with their columns, indexes and trigger", async () => {
    const db = await createPgliteDb();
    const columns = async (table: string) =>
      (
        await rawRows<{ column_name: string }>(
          db,
          sql`select column_name from information_schema.columns where table_name = ${table} order by ordinal_position`
        )
      ).map((c) => c.column_name);
    expect(await columns("maintenance_schedules")).toEqual([
      "id",
      "tool_id",
      "unit_id",
      "title",
      "instructions",
      "interval_count",
      "interval_unit",
      "next_due_on",
      "last_done_on",
      "status",
      "created_by",
      "updated_by",
      "created_at",
      "updated_at",
    ]);
    expect(await columns("maintenance_completions")).toEqual([
      "id",
      "schedule_id",
      "done_on",
      "due_on",
      "note",
      "done_by_user_id",
      "done_by_name",
      "created_at",
    ]);
    const indexes = await rawRows<{ indexname: string }>(
      db,
      sql`select indexname from pg_indexes where tablename in ('maintenance_schedules', 'maintenance_completions')`
    );
    expect(indexes.map((i) => i.indexname)).toEqual(
      expect.arrayContaining(["maintenance_schedules_status_due_idx", "maintenance_schedules_tool_idx", "maintenance_completions_schedule_idx"])
    );
    const triggers = await rawRows<{ tgname: string }>(db, sql`select tgname from pg_trigger where tgname = 'maintenance_schedules_set_updated_at'`);
    expect(triggers).toHaveLength(1);
  });
});
