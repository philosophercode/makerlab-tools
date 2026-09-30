import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { actorColumns, inListCheck, notionPageId, timestamps } from "./helpers.ts";
import { tools } from "./tools.ts";
import { FEEDBACK_STATUS, FLAG_FIELDS } from "./vocabulary.ts";

/**
 * Feedback — catalogue corrections, today's Notion "Flags" database
 * (spec §4.9). Filed by anyone through the correction form or the
 * `report_correction` tool; worked by admins on `/admin/corrections`.
 */
export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    toolId: uuid("tool_id").references(() => tools.id, { onDelete: "set null" }),
    fieldFlagged: text("field_flagged"),
    issueDescription: text("issue_description").notNull(),
    suggestedFix: text("suggested_fix"),
    reporterName: text("reporter_name"),
    reporterEmail: text("reporter_email"),
    reporterUserId: text("reporter_user_id"),
    status: text("status").notNull().default("new"),
    notionPageId: notionPageId(),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    inListCheck("feedback_field_flagged_check", "field_flagged", FLAG_FIELDS),
    inListCheck("feedback_status_check", "status", FEEDBACK_STATUS),
    index("feedback_tool_idx").on(t.toolId),
    index("feedback_status_idx").on(t.status),
  ]
);
