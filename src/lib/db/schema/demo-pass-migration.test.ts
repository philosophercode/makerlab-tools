// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { expectViolation } from "../../../../test/db";
import { migrationsFolder } from "../migrations-folder";
import { createPgliteDb } from "../pglite";
import { rawRows } from "../raw";
import { maintenanceLogs, usageEvents } from "./index";

/**
 * Migration `0032` (demo pass spec 2026-10-07 §4): the `demo_signups` table
 * and its `updated_at` trigger, `maintenance_logs.demo` (false for every
 * existing ticket), and `demo` as a usage audience. The behaviour is
 * `data/demo-signups.test.ts`; this pins the shape and the journal order.
 */

describe("migration 0032 — demo pass", () => {
  it("is the journal's entry 32, after every earlier migration", () => {
    const journal = JSON.parse(readFileSync(join(migrationsFolder(), "meta", "_journal.json"), "utf8")) as {
      entries: { idx: number; when: number; tag: string }[];
    };
    const at = journal.entries.findIndex((entry) => entry.tag === "0032_demo_pass");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(journal.entries[at].idx).toBe(32);
    for (const before of journal.entries.slice(0, at)) expect(before.when).toBeLessThan(journal.entries[at].when);
  });

  it("creates demo_signups with its columns and keeps updated_at by trigger", async () => {
    const db = await createPgliteDb();
    const columns = await rawRows<{ column_name: string }>(
      db,
      sql`select column_name from information_schema.columns where table_name = 'demo_signups' order by ordinal_position`
    );
    expect(columns.map((c) => c.column_name)).toEqual([
      "id",
      "name",
      "email",
      "institution",
      "role",
      "runs_makerspace",
      "use_case",
      "consent_to_contact",
      "pass_expires_at",
      "spent_usd",
      "charged_turns",
      "last_used_at",
      "created_at",
      "updated_at",
    ]);
    const [row] = await rawRows<{ id: string; updated_at: string }>(
      db,
      sql`insert into demo_signups (name, email, institution, pass_expires_at, updated_at)
          values ('Ada', 'ada@example.org', 'Lab', now() + interval '14 days', now() - interval '1 day')
          returning id, updated_at::text`
    );
    await db.execute(sql`update demo_signups set spent_usd = 0.01 where id = ${row.id}`);
    const [after] = await rawRows<{ updated_at: string }>(db, sql`select updated_at::text from demo_signups where id = ${row.id}`);
    expect(after.updated_at).not.toBe(row.updated_at);
    await expectViolation(db.execute(sql`update demo_signups set spent_usd = -1 where id = ${row.id}`), /demo_signups_spent_check/);
  });

  it("adds maintenance_logs.demo, false unless set, and accepts demo as a usage audience", async () => {
    const db = await createPgliteDb();
    const [ticket] = await db.insert(maintenanceLogs).values({ title: "Old ticket" }).returning({ demo: maintenanceLogs.demo });
    expect(ticket.demo).toBe(false);
    await db.insert(usageEvents).values({ kind: "chat_turn", surface: "chat", audience: "demo" });
    await expectViolation(db.insert(usageEvents).values({ kind: "chat_turn", surface: "chat", audience: "visitor" }), /usage_events_audience_check/);
  });
});
