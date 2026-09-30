import { bigint, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { feedback } from "./feedback.ts";
import { inListCheck, userReference } from "./helpers.ts";
import { manualDocuments } from "./manuals.ts";
import { tools } from "./tools.ts";
import { GAP_KINDS, GAP_STATUS, QUESTION_KINDS, USAGE_AUDIENCE, USAGE_KINDS, USAGE_SURFACE } from "./vocabulary.ts";

/**
 * Usage insight (usage insight spec §4; migration `0022`): what the lab asks
 * about, counted without anyone in it.
 *
 * **No column names a person.** No user id, session, chat id, token id, IP
 * (hashed or not), email or user agent — the only thing recorded about who
 * caused an event is `audience`, a three-value bucket from their role. That is
 * a property of the schema, not a filter on a page: nothing here can answer
 * "what did Casey ask". `usage_gaps.decided_by` is the *staff member* who
 * dismissed or filed a gap, as every admin queue records.
 *
 * - `usage_events` — raw events, **30 days** (`lib/usage/rollup.ts` prunes).
 * - `usage_rollups` — hourly counts, kept indefinitely. Its `tool_id` and
 *   `manual_document_id` are deliberately **not** foreign keys: an
 *   `on delete set null` would fold a deleted tool's rows into the null key and
 *   collide on the unique index, and a deleted tool's history is still worth
 *   counting ("Deleted tool").
 * - `usage_gaps` — the Unanswered queue: one row per normalised question and
 *   tool, holding the **latest** occurrence's scrubbed wording (≤ 300 chars),
 *   deleted **30 days** after it was last asked (owner decision 2026-09-28),
 *   so no stored question text is older than that. Counts survive in the
 *   rollups' `gap` rows.
 *
 * `usage_events` and `usage_gaps` are held back from the nightly backup and
 * from `data:push` (`cron/backup-policy.ts`): a three-year backup would break
 * the 30-day promise.
 */

export const usageGaps = pgTable(
  "usage_gaps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** `lib/usage/gap-key.ts`: the normalised scrubbed question + the tool id. */
    key: text("key").notNull().unique(),
    kind: text("kind").notNull(),
    toolId: uuid("tool_id").references(() => tools.id, { onDelete: "set null" }),
    /** Scrubbed (`lib/usage/scrub.ts`), ≤ 300 characters: the latest occurrence's wording. */
    question: text("question").notNull(),
    occurrences: integer("occurrences").notNull().default(1),
    /** `occurrences` when it was dismissed: three more reopen it. */
    dismissedAtOccurrences: integer("dismissed_at_occurrences"),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
    status: text("status").notNull().default("open"),
    /** The correction `insights.file_correction` created. */
    feedbackId: uuid("feedback_id").references(() => feedback.id, { onDelete: "set null" }),
    /** The staff member who dismissed or filed it — never the student. */
    decidedBy: userReference("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [
    inListCheck("usage_gaps_kind_check", "kind", GAP_KINDS),
    inListCheck("usage_gaps_status_check", "status", GAP_STATUS),
    index("usage_gaps_status_idx").on(t.status),
    index("usage_gaps_last_seen_idx").on(t.lastSeen),
  ]
);

export const usageEvents = pgTable(
  "usage_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    kind: text("kind").notNull(),
    surface: text("surface").notNull(),
    /** The only thing recorded about the person. */
    audience: text("audience").notNull(),
    toolId: uuid("tool_id").references(() => tools.id, { onDelete: "set null" }),
    manualDocumentId: uuid("manual_document_id").references(() => manualDocuments.id, { onDelete: "set null" }),
    /** The cited page (`manual_cited`). */
    page: integer("page"),
    /** `qr` | `direct` (views), `screen` | `qr` (kiosk), the gap kind (gaps), the tool name (MCP). */
    source: text("source"),
    /** `chat_turn` only. */
    questionKind: text("question_kind"),
    locale: text("locale"),
    gapId: uuid("gap_id").references(() => usageGaps.id, { onDelete: "set null" }),
  },
  (t) => [
    inListCheck("usage_events_kind_check", "kind", USAGE_KINDS),
    inListCheck("usage_events_surface_check", "surface", USAGE_SURFACE),
    inListCheck("usage_events_audience_check", "audience", USAGE_AUDIENCE),
    inListCheck("usage_events_question_kind_check", "question_kind", QUESTION_KINDS),
    index("usage_events_occurred_at_idx").on(t.occurredAt),
    index("usage_events_tool_idx").on(t.toolId),
  ]
);

export const usageRollups = pgTable(
  "usage_rollups",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    /** UTC; the page converts to lab time. */
    hourStart: timestamp("hour_start", { withTimezone: true }).notNull(),
    kind: text("kind").notNull(),
    surface: text("surface").notNull(),
    audience: text("audience").notNull(),
    toolId: uuid("tool_id"),
    manualDocumentId: uuid("manual_document_id"),
    page: integer("page"),
    source: text("source"),
    questionKind: text("question_kind"),
    count: integer("count").notNull(),
  },
  (t) => [
    unique("usage_rollups_key")
      .on(t.hourStart, t.kind, t.surface, t.audience, t.toolId, t.manualDocumentId, t.page, t.source, t.questionKind)
      .nullsNotDistinct(),
    index("usage_rollups_hour_idx").on(t.hourStart),
  ]
);
