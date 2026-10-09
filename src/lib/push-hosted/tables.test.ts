// @vitest-environment node
import { getTableName } from "drizzle-orm";
import { getTableConfig, pgTable, text, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { planTables, schemaTables } from "./tables.ts";

/**
 * `data:push`'s table plan: every schema table but the sign-in ones, parents
 * before children, self-references and cycles deferred, generated columns
 * never inserted, and the backup policy's secret columns blanked.
 */

describe("planTables", () => {
  const plan = planTables();
  const position = new Map(plan.tables.map((t, i) => [t.name, i]));

  it("copies every schema table except live sign-ins, the retention-bound usage tables and the deployment-bound starter answers and chat illustrations", () => {
    // usage_events and usage_gaps are promised to be short-lived (usage insight
    // spec §4): a local database's test events never land in the hosted one.
    // starter_answers carry the local database's own addresses and hashes;
    // staff_shifts is somebody being at this lab now (on-shift spec 2026-10-07);
    // chat_illustrations name private blobs data:push does not copy;
    // demo_signups are visitors' details, kept where they were collected.
    expect(plan.skipped).toEqual(["chat_illustrations", "demo_signups", "oauth_access_token", "session", "staff_shifts", "starter_answers", "usage_events", "usage_gaps", "verification"]);
    const all = schemaTables().map(getTableName).sort();
    expect([...plan.tables.map((t) => t.name), ...plan.skipped].sort()).toEqual(all);
    expect(position.has("user")).toBe(true);
    expect(position.has("account")).toBe(true);
    // Tool skills travel (tool skills spec §4.3): manual sources are document
    // ids and pages, links the manufacturer's URLs — nothing deployment-local.
    expect(position.get("tool_skills")).toBeGreaterThan(position.get("tools")!);
  });

  it("puts every referenced table before the table that references it", () => {
    for (const table of schemaTables()) {
      const config = getTableConfig(table);
      if (!position.has(config.name)) continue;
      for (const fk of config.foreignKeys) {
        const target = getTableName(fk.reference().foreignTable);
        if (target === config.name || !position.has(target)) continue;
        expect(position.get(target), `${config.name} → ${target}`).toBeLessThan(position.get(config.name)!);
      }
    }
  });

  it("defers the pending_tools self-reference to a second pass", () => {
    const pending = plan.tables.find((t) => t.name === "pending_tools")!;
    expect(pending.deferred).toEqual(["duplicate_of_pending_id"]);
    expect(pending.primaryKey).toEqual(["id"]);
    const others = plan.tables.filter((t) => !["pending_tools", "categories", "tools"].includes(t.name));
    expect(others.every((t) => t.deferred.length === 0)).toBe(true);
  });

  it("defers taxonomy v2's self-references: a category's parent and merge target, a tool's parent tool", () => {
    const byName = new Map(plan.tables.map((t) => [t.name, t]));
    expect(byName.get("categories")!.deferred.sort()).toEqual(["merged_into_id", "parent_id"]);
    expect(byName.get("tools")!.deferred).toEqual(["parent_tool_id"]);
    expect(byName.has("category_proposals")).toBe(true);
  });

  it("never inserts GENERATED ALWAYS columns", () => {
    const chunks = plan.tables.find((t) => t.name === "manual_chunks")!;
    expect(chunks.generated).toEqual(["tsv"]);
    expect(chunks.columns).not.toContain("tsv");
    expect(chunks.columns).toContain("embedding");
  });

  it("blanks the backup policy's secret columns, by SQL name", () => {
    const byName = new Map(plan.tables.map((t) => [t.name, t]));
    expect(byName.get("account")!.redacted).toEqual(["access_token", "refresh_token", "id_token", "password"]);
    expect(byName.get("notion_mirrors")!.redacted).toEqual(["token_ciphertext"]);
    expect(byName.get("oauth_application")!.redacted).toEqual(["client_secret"]);
    expect(byName.get("user")!.redacted).toEqual([]);
  });

  it("finds composite primary keys", () => {
    expect(plan.tables.find((t) => t.name === "project_tools")!.primaryKey.sort()).toEqual(["project_id", "tool_id"]);
  });

  it("breaks a cycle between tables on its nullable edge", () => {
    const a = pgTable("cycle_a", {
      id: uuid("id").primaryKey(),
      bId: uuid("b_id").references((): AnyPgColumn => b.id),
    });
    const b = pgTable("cycle_b", {
      id: uuid("id").primaryKey(),
      aId: uuid("a_id")
        .notNull()
        .references((): AnyPgColumn => a.id),
    });
    const cyclic = planTables([b, a]);
    expect(cyclic.tables.map((t) => t.name)).toEqual(["cycle_a", "cycle_b"]);
    expect(cyclic.tables[0].deferred).toEqual(["b_id"]);
    expect(cyclic.tables[1].deferred).toEqual([]);
  });

  it("refuses a cycle made only of NOT NULL columns", () => {
    const a = pgTable("strict_a", {
      id: text("id").primaryKey(),
      bId: text("b_id")
        .notNull()
        .references((): AnyPgColumn => b.id),
    });
    const b = pgTable("strict_b", {
      id: text("id").primaryKey(),
      aId: text("a_id")
        .notNull()
        .references((): AnyPgColumn => a.id),
    });
    expect(() => planTables([a, b])).toThrow(/NOT NULL foreign-key cycle/);
  });
});
