import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import type { ResearchResult } from "../../research/result.ts";
import { user } from "./auth.ts";
import { inListCheck, timestamps, userReference } from "./helpers.ts";
import { tools } from "./tools.ts";
import { units } from "./units.ts";
import { DUPLICATE_RESOLUTION, PENDING_STATUS } from "./vocabulary.ts";

/**
 * Pending tools — equipment identified in the chat and waiting to be
 * researched and approved (spec §4.10, §5.4).
 *
 * A row here is scratch work, never catalogue: identification creates one,
 * the research workflow fills `research`, and only a person pressing Approve
 * turns it into a `tools` row (Article 5). That is why `created_by` is the one
 * actor column in the schema that is **not null and cascades**: the spec says
 * a pending item always has an owner, and an unapproved draft belonging to an
 * account that no longer exists is nothing anybody can act on. Everything else
 * that names a person is `on delete set null`, as elsewhere.
 *
 * - `batch_id` groups the items identified together in one chat turn. It is not
 *   a foreign key — there is no batch table; selection is sent as ids (§4.10).
 * - `duplicate_of_tool_id` / `duplicate_of_pending_id` are what the duplicate
 *   check found at creation; `duplicate_resolution` is what the person decided.
 * - `research` is jsonb, validated by `researchResultSchema` on write and on
 *   read. `research_error` is the diagnosis record when a run fails (the
 *   2026-09-22 amendment: build as though the workflow dashboard does not
 *   exist).
 * - Photos are `attachments` rows owned by `pending_tool`; approval re-owns
 *   them to the new tool without moving the bytes (§4.7).
 */
export const pendingTools = pgTable(
  "pending_tools",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id").notNull(),
    status: text("status").notNull().default("identified"),
    name: text("name").notNull(),
    brand: text("brand"),
    categoryHint: text("category_hint"),
    locationHint: text("location_hint"),
    serialNumber: text("serial_number"),
    duplicateOfToolId: uuid("duplicate_of_tool_id").references(() => tools.id, {
      onDelete: "set null",
    }),
    duplicateOfPendingId: uuid("duplicate_of_pending_id").references(
      (): AnyPgColumn => pendingTools.id,
      { onDelete: "set null" }
    ),
    duplicateResolution: text("duplicate_resolution"),
    research: jsonb("research").$type<ResearchResult>(),
    researchError: text("research_error"),
    workflowRunId: text("workflow_run_id"),
    // The Research press that last queued this row. A research step writes
    // only while this is still its own request, so a run a later press took the
    // row over from cannot claim it too (§8 "Write safety").
    researchRequestId: uuid("research_request_id"),
    researchRequestedBy: userReference("research_requested_by"),
    researchRequestedAt: timestamp("research_requested_at", { withTimezone: true }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    approvedBy: userReference("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalNote: text("approval_note"),
    createdToolId: uuid("created_tool_id").references(() => tools.id, { onDelete: "set null" }),
    createdUnitId: uuid("created_unit_id").references(() => units.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    inListCheck("pending_tools_status_check", "status", PENDING_STATUS),
    inListCheck(
      "pending_tools_duplicate_resolution_check",
      "duplicate_resolution",
      DUPLICATE_RESOLUTION
    ),
    index("pending_tools_status_idx").on(t.status),
    index("pending_tools_batch_idx").on(t.batchId),
    // The daily cron finds research a run abandoned by when it was requested.
    // (The allowance is counted from `research_requests`, below.)
    index("pending_tools_requested_idx").on(t.researchRequestedBy, t.researchRequestedAt),
    // The duplicate check reads pending names too — two admins adding the same
    // machine at once must see each other (§5.4 unhappy paths).
    index("pending_tools_name_trgm_idx").using("gin", sql`${t.name} gin_trgm_ops`),
  ]
);

/**
 * One row per item per Research press — the ledger the daily allowance is
 * counted from (§5.4 step 6, §8: "100 researched items per person per day").
 *
 * `pending_tools.research_requested_at` cannot be the count: it is overwritten
 * by every press, so an item researched five times would cost one. This table
 * is only ever inserted into, in the same transaction that queues the items,
 * and counted over the last 24 hours. It is keyed on who pressed Research, not
 * who identified the item: an approver researching somebody else's batch
 * spends their own allowance, and nobody else's goes down.
 *
 * `pending_tool_id` is `set null`, so the daily cron deleting a discarded item
 * does not hand its presses back to the allowance. Add-unit items skip
 * research and are never written here.
 */
export const researchRequests = pgTable(
  "research_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    pendingToolId: uuid("pending_tool_id").references(() => pendingTools.id, { onDelete: "set null" }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("research_requests_user_idx").on(t.userId, t.requestedAt)]
);
