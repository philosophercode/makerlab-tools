import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { ResearchResult } from "../../research/result.ts";
import type { FieldProposal } from "../../refresh/types.ts";
import { inListCheck, timestamps, userReference } from "./helpers.ts";
import { tools } from "./tools.ts";
import { PROPOSAL_SUBJECT_KIND, REFRESH_STATUS } from "./vocabulary.ts";

/**
 * Refresh research (refresh research spec §4.1, §12.2; migration `0012`).
 *
 * `tool_refreshes` — one background re-research of an existing tool: the run
 * that owns it (`request_id`, as on `pending_tools`), the tool's revision when
 * it was queued (`base_revision`, the editor's optimistic token — accepting
 * writes only while the tool still carries it), the research result and the
 * proposals code derived from it. A tool has at most one open refresh: the
 * partial unique index. Deleting the tool cascades; archiving it does not.
 *
 * `chat_proposals` — one change the assistant put in front of an admin in a
 * curation turn (§12). Same `FieldProposal` shape; the subject is a tool or a
 * pending item, so `subject_id` is not a foreign key. It expires after seven
 * days: accepting an expired one is refused.
 *
 * Relative imports with `.ts` extensions: the refresh workflow's steps load
 * the schema under plain Node.
 */
export const toolRefreshes = pgTable(
  "tool_refreshes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    toolId: uuid("tool_id")
      .notNull()
      .references(() => tools.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("queued"),
    requestId: uuid("request_id").notNull(),
    baseRevision: text("base_revision").notNull(),
    note: text("note"),
    includeDescription: boolean("include_description").notNull().default(false),
    research: jsonb("research").$type<ResearchResult>(),
    proposals: jsonb("proposals").$type<FieldProposal[]>(),
    researchError: text("research_error"),
    workflowRunId: text("workflow_run_id"),
    requestedBy: userReference("requested_by"),
    decidedBy: userReference("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    inListCheck("tool_refreshes_status_check", "status", REFRESH_STATUS),
    uniqueIndex("tool_refreshes_one_open_idx")
      .on(t.toolId)
      .where(sql`${t.status} in ('queued', 'researching', 'proposed')`),
    index("tool_refreshes_status_idx").on(t.status),
    index("tool_refreshes_tool_idx").on(t.toolId),
  ]
);

export const chatProposals = pgTable(
  "chat_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subjectKind: text("subject_kind").notNull(),
    subjectId: uuid("subject_id").notNull(),
    proposal: jsonb("proposal").$type<FieldProposal>().notNull(),
    baseRevision: text("base_revision").notNull(),
    chatId: text("chat_id"),
    createdBy: userReference("created_by"),
    decidedBy: userReference("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '7 days'`),
    ...timestamps(),
  },
  (t) => [
    inListCheck("chat_proposals_subject_kind_check", "subject_kind", PROPOSAL_SUBJECT_KIND),
    index("chat_proposals_subject_idx").on(t.subjectKind, t.subjectId),
  ]
);
