// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { migrationsFolder } from "../migrations-folder";
import { createPgliteDb } from "../pglite";
import { rawRows } from "../raw";
import { seedTool } from "../../../../test/manuals/seed";
import { tools, toolSkills } from "./index";

/**
 * Migration `0031` (tool skills spec 2026-10-07): the `tool_skills` table,
 * last in the journal with a later timestamp than every entry before it
 * (drizzle skips an out-of-order one), its vocabulary checks, one version per
 * tool, and its rows go with their tool.
 */

describe("migration 0031 — tool_skills", () => {
  it("is in the journal at 31, after every earlier migration", () => {
    const journal = JSON.parse(readFileSync(join(migrationsFolder(), "meta", "_journal.json"), "utf8")) as {
      entries: { idx: number; when: number; tag: string }[];
    };
    const at = journal.entries.findIndex((entry) => entry.tag === "0031_tool_skills");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(journal.entries[at].idx).toBe(31);
    for (const before of journal.entries.slice(0, at)) expect(before.when).toBeLessThan(journal.entries[at].when);
  });

  it("creates the table with its columns, checks, a version per tool, and cascades with the tool", async () => {
    const db = await createPgliteDb();
    const columns = await rawRows<{ column_name: string }>(
      db,
      sql`select column_name from information_schema.columns where table_name = 'tool_skills' order by ordinal_position`
    );
    expect(columns.map((c) => c.column_name)).toEqual([
      "id",
      "tool_id",
      "version",
      "status",
      "content",
      "sections",
      "sources",
      "input_hash",
      "model",
      "cost_usd",
      "trigger",
      "error",
      "created_at",
    ]);

    const toolId = await seedTool(db, { name: "Form 4", slug: "form-4-skills" });
    await db.insert(toolSkills).values({ toolId, version: 1, status: "ready", content: "# Form 4", inputHash: "sha256:a", model: "stub/model", trigger: "manual" });
    const [row] = await db.select().from(toolSkills);
    expect(row).toMatchObject({ version: 1, status: "ready", sections: {}, sources: [], costUsd: 0, error: null });
    expect(row.createdAt).toBeInstanceOf(Date);

    // One row per version per tool.
    await expect(
      db.insert(toolSkills).values({ toolId, version: 1, status: "failed", inputHash: "sha256:b", model: "stub/model", trigger: "manual" })
    ).rejects.toThrow();
    // Only the stored vocabularies.
    await expect(
      db.insert(toolSkills).values({ toolId, version: 2, status: "pending", inputHash: "sha256:c", model: "stub/model", trigger: "manual" })
    ).rejects.toThrow();
    await expect(
      db.insert(toolSkills).values({ toolId, version: 2, status: "ready", inputHash: "sha256:c", model: "stub/model", trigger: "cron" })
    ).rejects.toThrow();

    await db.delete(tools).where(eq(tools.id, toolId));
    expect(await db.select().from(toolSkills)).toHaveLength(0);
  });
});
