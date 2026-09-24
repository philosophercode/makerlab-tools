import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { attachments } from "./attachments.ts";
import { inListCheck, timestamps } from "./helpers.ts";
import { tools } from "./tools.ts";
import { MANUAL_DOCUMENT_STATUS, MANUAL_OUTLINE_SOURCE } from "./vocabulary.ts";

/**
 * Manual text (manual text and search spec §4; migration `0010`, phase 1).
 *
 * One `manual_documents` row per stored PDF (an `attachments` row — an
 * archived manual or a staff upload on a resource), and its text page by page
 * in `manual_pages`. Phase 2's `manual_chunks` and the `vector` extension are
 * not here yet.
 *
 * - `attachment_id` is **unique and cascades**: a document is the text of one
 *   stored file, and goes when the file's row does. A resource whose link
 *   changes gets a new attachment and so a new document.
 * - `tool_id` is copied from the resource at processing time, for scoping.
 * - `extractor_version` is the idempotency key with `attachment_id`: the same
 *   version is a no-op, a newer one re-processes (`manuals/index-document.ts`).
 * - `embedding_model` is phase 2's; null until then.
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
