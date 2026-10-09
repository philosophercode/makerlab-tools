// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { migrationsFolder } from "../migrations-folder";
import { createPgliteDb } from "../pglite";
import { rawRows } from "../raw";
import { seedManual, seedTool } from "../../../../test/manuals/seed";
import { attachments, manualDocuments, manualEvalQuestions } from "./index";

/**
 * Migration `0028` (manual text spec amendment 2026-10-07): the
 * `manual_eval_questions` table, last in the journal, and its rows go with
 * their document.
 */

describe("migration 0028 — manual_eval_questions", () => {
  it("is in the journal at 28, after every earlier migration", () => {
    const journal = JSON.parse(readFileSync(join(migrationsFolder(), "meta", "_journal.json"), "utf8")) as {
      entries: { idx: number; when: number; tag: string }[];
    };
    const at = journal.entries.findIndex((entry) => entry.tag === "0028_manual_eval_questions");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(journal.entries[at].idx).toBe(28);
    for (const before of journal.entries.slice(0, at)) expect(before.when).toBeLessThan(journal.entries[at].when);
  });

  it("creates the table, and a document's questions go when the document does", async () => {
    const db = await createPgliteDb();
    const columns = await rawRows<{ column_name: string }>(
      db,
      sql`select column_name from information_schema.columns where table_name = 'manual_eval_questions' order by ordinal_position`
    );
    expect(columns.map((c) => c.column_name)).toEqual([
      "id",
      "document_id",
      "tool_id",
      "question",
      "expected_pages",
      "chunk_ordinal",
      "section_path",
      "expected_answer",
      "source_hash",
      "model",
      "created_at",
    ]);

    const toolId = await seedTool(db, { name: "Form 4" });
    const { documentId, attachmentId } = await seedManual(db, { toolId, title: "Form 4 Manual", pages: ["Replace the tank."] });
    await db.insert(manualEvalQuestions).values({
      documentId,
      toolId,
      question: "How do I replace the tank?",
      expectedPages: [1],
      chunkOrdinal: 0,
      expectedAnswer: "Lift it out.",
      sourceHash: "sha256:x",
      model: "fixture",
    });
    const [row] = await db.select().from(manualEvalQuestions);
    expect(row).toMatchObject({ expectedPages: [1], sectionPath: [] });
    expect(row.createdAt).toBeInstanceOf(Date);

    await db.delete(attachments).where(eq(attachments.id, attachmentId));
    expect(await db.select().from(manualDocuments)).toHaveLength(0);
    expect(await db.select().from(manualEvalQuestions)).toHaveLength(0);
  });
});
