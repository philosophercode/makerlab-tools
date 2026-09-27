// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { expectViolation } from "../../../../test/db";
import { rawRows } from "../raw";
import { migrationsFolder } from "../migrations-folder";
import { createPgliteDb } from "../pglite";
import type { Db } from "../types";
import { attachments } from "./attachments";
import { manualDocuments, manualPages } from "./manuals";
import { resources } from "./resources";
import { tools } from "./tools";

/**
 * Migration `0018` (manual text spec phase 3) against a real in-process
 * Postgres with pgvector: `manual_pages.source`, `manual_documents.ocr_version`,
 * and the embedding column turned into `halfvec(512)` **with passages already
 * in it** — as on Neon, which has rows. The embedding statements are read from
 * the migration file itself and run over a table put back the way `0011` made
 * it, so an edit to the file is what is tested.
 */

function embeddingStatements(): string[] {
  const file = readFileSync(join(migrationsFolder(), "0018_manual_phase3.sql"), "utf8");
  return file
    .split("--> statement-breakpoint")
    .map((part) => part.replace(/^\s*--.*$/gm, "").trim())
    .filter((part) => /embedding/.test(part));
}

async function seedDocument(db: Db): Promise<string> {
  const [tool] = await db.insert(tools).values({ slug: `t-${crypto.randomUUID()}`, name: "Tool" }).returning({ id: tools.id });
  const [resource] = await db.insert(resources).values({ toolId: tool.id, title: "Manual", type: "Manual" }).returning({ id: resources.id });
  const [attachment] = await db
    .insert(attachments)
    .values({ ownerType: "resource", ownerId: resource.id, blobPathname: `m/${resource.id}.pdf`, access: "public", contentType: "application/pdf" })
    .returning({ id: attachments.id });
  const [doc] = await db
    .insert(manualDocuments)
    .values({ attachmentId: attachment.id, toolId: tool.id, title: "Manual", status: "ready", extractorVersion: "x", processedAt: new Date() })
    .returning({ id: manualDocuments.id });
  return doc.id;
}

const vector = (axis: number) => `[${Array.from({ length: 512 }, (_, i) => (i === axis ? 1 : i === axis + 1 ? 0.25 : 0)).join(",")}]`;

describe("migration 0018", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createPgliteDb();
  });

  it("gives every page a source, text unless OCR read it, and nothing else", async () => {
    const documentId = await seedDocument(db);
    await db.insert(manualPages).values({ documentId, pageNumber: 1, text: "Hello" });
    await db.insert(manualPages).values({ documentId, pageNumber: 2, text: "Scan", source: "ocr" });
    const rows = await db.select({ page: manualPages.pageNumber, source: manualPages.source }).from(manualPages);
    expect(rows.sort((a, b) => a.page - b.page)).toEqual([
      { page: 1, source: "text" },
      { page: 2, source: "ocr" },
    ]);
    await expectViolation(db.insert(manualPages).values({ documentId, pageNumber: 3, text: "x", source: "guess" }), /manual_pages_source_check/);
  });

  it("records the OCR version on the document, null by default", async () => {
    const documentId = await seedDocument(db);
    const [row] = await rawRows<{ ocr_version: string | null }>(db, sql`select ocr_version from manual_documents where id = ${documentId}`);
    expect(row.ocr_version).toBeNull();
  });

  it("turns existing vector(512) embeddings into halfvec(512) in place, index rebuilt, search working", async () => {
    const fresh = await createPgliteDb();
    // Back to the 0011 shape, with a passage in it.
    await fresh.execute(sql.raw(`drop index "manual_chunks_embedding_idx"`));
    await fresh.execute(sql.raw(`alter table manual_chunks alter column embedding type vector(512) using embedding::vector(512)`));
    await fresh.execute(sql.raw(`create index "manual_chunks_embedding_idx" on manual_chunks using hnsw (embedding vector_cosine_ops)`));
    const documentId = await seedDocument(fresh);
    for (const [ordinal, axis] of [
      [0, 3],
      [1, 40],
    ]) {
      await fresh.execute(
        sql`insert into manual_chunks (document_id, ordinal, page_start, page_end, content, search_text, embedding)
            values (${documentId}, ${ordinal}, 1, 1, 'text', 'text', ${vector(axis)}::vector)`
      );
    }

    for (const statement of embeddingStatements()) await fresh.execute(sql.raw(statement));

    const [column] = await rawRows<{ type: string }>(
      fresh,
      sql`select format_type(atttypid, atttypmod) as type from pg_attribute
           where attrelid = 'manual_chunks'::regclass and attname = 'embedding'`
    );
    expect(column.type).toBe("halfvec(512)");
    const [index] = await rawRows<{ def: string }>(fresh, sql`select indexdef as def from pg_indexes where indexname = 'manual_chunks_embedding_idx'`);
    expect(index.def).toContain("halfvec_cosine_ops");

    // The values survived (1 and 0.25 are exact in half precision), and a cosine search finds the nearest.
    const [kept] = await rawRows<{ e: string }>(fresh, sql`select embedding::text as e from manual_chunks where ordinal = 0`);
    expect(kept.e).toBe(vector(3));
    const [nearest] = await rawRows<{ ordinal: number }>(
      fresh,
      sql`select ordinal from manual_chunks order by embedding <=> ${vector(40)}::halfvec(512) limit 1`
    );
    expect(Number(nearest.ordinal)).toBe(1);
  });
});
