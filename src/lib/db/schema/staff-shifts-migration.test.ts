// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { migrationsFolder } from "../migrations-folder";
import { createPgliteDb } from "../pglite";
import { rawRows } from "../raw";
import { user } from "./auth";
import { staffShifts } from "./staff-shifts";

/**
 * Migration `0033` (on-shift spec 2026-10-07): the `staff_shifts` table. The
 * behaviour is `data/staff-shifts.test.ts`; this pins the shape, the journal
 * order and the one foreign key, which must cascade: a removed person's shift
 * goes with them.
 */

describe("migration 0033 — staff shifts", () => {
  it("is the journal's entry 33, after every earlier migration", () => {
    const journal = JSON.parse(readFileSync(join(migrationsFolder(), "meta", "_journal.json"), "utf8")) as {
      entries: { idx: number; when: number; tag: string }[];
    };
    const at = journal.entries.findIndex((entry) => entry.tag === "0033_staff_shifts");
    expect(at).toBeGreaterThanOrEqual(0);
    const entry = journal.entries[at];
    expect(entry.idx).toBe(33);
    for (const before of journal.entries.slice(0, at)) expect(before.when).toBeLessThan(entry.when);
  });

  it("creates the table with an id and two times, and nothing else", async () => {
    const db = await createPgliteDb();
    const columns = await rawRows<{ column_name: string }>(
      db,
      sql`select column_name from information_schema.columns where table_name = 'staff_shifts' order by ordinal_position`
    );
    expect(columns.map((c) => c.column_name)).toEqual(["user_id", "ends_at", "started_at"]);
  });

  it("deletes a person's shift with the person", async () => {
    const db = await createPgliteDb();
    await db.insert(user).values({ id: "u-leaver", name: "Alex Morgan", email: "alex@cornell.edu", role: "admin" });
    await db.insert(staffShifts).values({ userId: "u-leaver", endsAt: new Date(Date.now() + 3_600_000) });
    await db.delete(user).where(eq(user.id, "u-leaver"));
    expect(await db.select().from(staffShifts)).toEqual([]);
  });
});
