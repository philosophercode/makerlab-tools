import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { ColumnMap } from "../../import/columns.ts";
import { attachments } from "./attachments.ts";
import { user } from "./auth.ts";
import { inListCheck, timestamps, userReference } from "./helpers.ts";
import { IMPORT_FORMAT, IMPORT_SOURCE_KIND, IMPORT_STATUS } from "./vocabulary.ts";

/**
 * Bulk intake (bulk intake spec §4; migration `0013`).
 *
 * `bulk_imports` — one list somebody imported: where it came from, the text it
 * was read from, the column matches they confirmed and what it came to. Its
 * rows are ordinary `pending_tools` rows in the **identified** state, sharing
 * the import's `batch_id` and pointing back through `pending_tools.import_id`,
 * so research, approval and the 14-day expiry are the pipeline intake already
 * has. The import row itself stays as history.
 *
 * - `source_text` is the text the rows were parsed from — the file as UTF-8,
 *   the paste, or a PDF's extracted text — capped at the import limits. It is
 *   what makes a half-mapped import resumable and what the document workflow
 *   reads (amendment "The source text is kept on the row").
 * - `source_attachment_id` is the uploaded file itself, private Blob, owned by
 *   the import (`attachments.owner_type = 'bulk_import'`), when there was one.
 * - `column_map` is header index → field, as confirmed; null until then.
 *
 * `research_allowances` — a **setup allowance** (§4.2): extra research items a
 * super admin grants somebody for a while, on top of the daily 100. Only ever
 * inserted; every grant is audited (`allowance.granted`).
 *
 * Relative imports with `.ts` extensions: step code loads the schema under
 * plain Node.
 */
export const bulkImports = pgTable(
  "bulk_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id").notNull(),
    sourceKind: text("source_kind").notNull(),
    format: text("format").notNull(),
    sourceAttachmentId: uuid("source_attachment_id").references(() => attachments.id, { onDelete: "set null" }),
    sourceName: text("source_name"),
    sourceText: text("source_text").notNull(),
    columnMap: jsonb("column_map").$type<ColumnMap>(),
    status: text("status").notNull().default("parsing"),
    parseError: text("parse_error"),
    rowCount: integer("row_count").notNull().default(0),
    itemCount: integer("item_count").notNull().default(0),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    workflowRunId: text("workflow_run_id"),
    // Nullable and `set null` since migration `0016` (auth spec amendment
    // 2026-09-25): an import stays as history when its author is removed.
    createdBy: userReference("created_by"),
    // Written only when the author's account is removed (`data/user-removal.ts`).
    createdByName: text("created_by_name"),
    ...timestamps(),
  },
  (t) => [
    inListCheck("bulk_imports_source_kind_check", "source_kind", IMPORT_SOURCE_KIND),
    inListCheck("bulk_imports_format_check", "format", IMPORT_FORMAT),
    inListCheck("bulk_imports_status_check", "status", IMPORT_STATUS),
    index("bulk_imports_created_idx").on(t.createdAt),
  ]
);

export const researchAllowances = pgTable(
  "research_allowances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    extraItems: integer("extra_items").notNull(),
    grantedBy: userReference("granted_by"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("research_allowances_user_idx").on(t.userId, t.expiresAt)]
);
