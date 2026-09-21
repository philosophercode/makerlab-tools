import { date, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { actorColumns, inListCheck, notionPageId, timestamps } from "./helpers.ts";
import { tools } from "./tools.ts";
import { units } from "./units.ts";
import { MAINTENANCE_PRIORITY, MAINTENANCE_STATUS, MAINTENANCE_TYPE } from "./vocabulary.ts";

/**
 * Maintenance logs — tickets filed by anyone, worked by admins (spec §4.8).
 *
 * - No CHECK requires a unit or a tool: most live logs have neither, and a
 *   ticket with no target is still a ticket.
 * - `tool_name` and `unit_label` are snapshots taken at write time so history
 *   survives a retired unit.
 * - `reported_by_email` is set only from a server-resolved session, never from
 *   tool or request input, and never enters a model prompt or the Notion mirror.
 * - Dates are `date`, computed in `LAB_TIMEZONE` by the write path, never from
 *   the server clock.
 */
export const maintenanceLogs = pgTable(
  "maintenance_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    type: text("type"),
    priority: text("priority"),
    status: text("status").notNull().default("open"),
    description: text("description"),
    resolution: text("resolution"),
    unitId: uuid("unit_id").references(() => units.id, { onDelete: "set null" }),
    toolId: uuid("tool_id").references(() => tools.id, { onDelete: "set null" }),
    toolName: text("tool_name"),
    unitLabel: text("unit_label"),
    reportedByName: text("reported_by_name"),
    reportedByEmail: text("reported_by_email"),
    reportedByUserId: text("reported_by_user_id"),
    assignedToUserId: text("assigned_to_user_id"),
    assignedToName: text("assigned_to_name"),
    dateReported: date("date_reported", { mode: "string" }),
    dateResolved: date("date_resolved", { mode: "string" }),
    notionPageId: notionPageId(),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    inListCheck("maintenance_logs_type_check", "type", MAINTENANCE_TYPE),
    inListCheck("maintenance_logs_priority_check", "priority", MAINTENANCE_PRIORITY),
    inListCheck("maintenance_logs_status_check", "status", MAINTENANCE_STATUS),
    index("maintenance_logs_unit_idx").on(t.unitId),
    index("maintenance_logs_tool_idx").on(t.toolId),
    index("maintenance_logs_status_idx").on(t.status),
  ]
);
