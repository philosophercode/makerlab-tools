import { sql } from "drizzle-orm";
import {
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { attachments } from "./attachments.ts";
import { inListCheck, timestamps } from "./helpers.ts";
import { tools } from "./tools.ts";
import { MANUAL_DOCUMENT_STATUS, MANUAL_OUTLINE_SOURCE } from "./vocabulary.ts";

/**
 * Manual text (manual text and search spec §4; migration `0010`, phase 1).
 *
 * One `manual_documents` row per stored PDF (an `attachments` row — an
 * archived manual or a staff upload on a resource), its text page by page in
 * `manual_pages`, and (phase 2, migration `0011`) its search passages in
 * `manual_chunks`, each indexed twice: a generated `tsvector` (GIN) and a
 * 512-dimension embedding (pgvector, HNSW cosine).
 *
 * - `attachment_id` is **unique and cascades**: a document is the text of one
 *   stored file, and goes when the file's row does. A resource whose link
 *   changes gets a new attachment and so a new document.
 * - `tool_id` is copied from the resource at processing time, for scoping.
 * - `extractor_version` is the idempotency key with `attachment_id`: the same
 *   version is a no-op, a newer one re-processes (`manuals/index-document.ts`).
 * - `chunker_version` and `embedding_model` (phase 2) say how the document's
 *   passages were built and embedded — `manuals/chunk.ts`'s `CHUNKER_VERSION`
 *   and e.g. `openai/text-embedding-3-small@512`. Both null until passages
 *   exist; a different value re-chunks and re-embeds (`manuals/passages.ts`).
 *
 * Relative imports with `.ts` extensions: the index step loads the schema
 * under plain Node.
 */

/** One entry of a document's outline: a chapter title, the 1-based PDF page it opens on, and its depth (1 = top). */
export interface ManualOutlineEntry {
  title: string;
  page: number;
  level: number;
}

export const manualDocuments = pgTable(
  "manual_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attachmentId: uuid("attachment_id")
      .notNull()
      .unique()
      .references(() => attachments.id, { onDelete: "cascade" }),
    toolId: uuid("tool_id").references(() => tools.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: text("status").notNull(),
    statusReason: text("status_reason"),
    pageCount: integer("page_count"),
    outline: jsonb("outline").$type<ManualOutlineEntry[]>().notNull().default([]),
    outlineSource: text("outline_source"),
    extractorVersion: text("extractor_version").notNull(),
    embeddingModel: text("embedding_model"),
    chunkerVersion: text("chunker_version"),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (t) => [
    inListCheck("manual_documents_status_check", "status", MANUAL_DOCUMENT_STATUS),
    inListCheck("manual_documents_outline_source_check", "outline_source", MANUAL_OUTLINE_SOURCE),
    index("manual_documents_tool_idx").on(t.toolId),
  ]
);

export const manualPages = pgTable(
  "manual_pages",
  {
    documentId: uuid("document_id")
      .notNull()
      .references(() => manualDocuments.id, { onDelete: "cascade" }),
    /** 1-based PDF page index — what `#page=N` opens. */
    pageNumber: integer("page_number").notNull(),
    /** The printed label ("iv", "3-12"), when the PDF declares page labels. */
    pageLabel: text("page_label"),
    text: text("text").notNull(),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.pageNumber] })]
);

/** The dimension every stored embedding has (spec §3.4). Changing it is a migration and a re-embed. */
export const MANUAL_EMBEDDING_DIMENSIONS = 512;

/** Postgres `tsvector`: drizzle has no built-in column type for it. */
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

/**
 * A manual's search passages (spec §3.3, §4; phase 2, migration `0011`).
 *
 * - A passage never crosses a section: `section_path` is its chapter trail
 *   (`["Maintenance", "Resin tank"]`), `page_start`/`page_end` the 1-based PDF
 *   pages it spans.
 * - `content` is the passage as the manual says it, for display and citation;
 *   `search_text` is the contextual header (`"<tool> — <document> › <section>"`)
 *   plus `content`, and is what both indexes see.
 * - `tsv` is **generated** from `search_text` (English configuration), so it
 *   can never disagree with it.
 * - `tool_id` is copied from the document for filtering; scoping and access are
 *   still decided through the document's attachment and resource
 *   (`manuals/search.ts`).
 */
export const manualChunks = pgTable(
  "manual_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => manualDocuments.id, { onDelete: "cascade" }),
    toolId: uuid("tool_id"),
    ordinal: integer("ordinal").notNull(),
    sectionPath: text("section_path").array().notNull().default(sql`'{}'::text[]`),
    pageStart: integer("page_start").notNull(),
    pageEnd: integer("page_end").notNull(),
    content: text("content").notNull(),
    searchText: text("search_text").notNull(),
    tsv: tsvector("tsv").generatedAlwaysAs(sql`to_tsvector('english', search_text)`),
    embedding: vector("embedding", { dimensions: MANUAL_EMBEDDING_DIMENSIONS }),
  },
  (t) => [
    index("manual_chunks_tsv_idx").using("gin", t.tsv),
    index("manual_chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("manual_chunks_tool_idx").on(t.toolId),
    index("manual_chunks_document_idx").on(t.documentId, t.ordinal),
  ]
);
