import { sql } from "drizzle-orm";
import { check, date, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { actorColumns, inListCheck, timestamps, userReference } from "./helpers.ts";
import { tools } from "./tools.ts";
import { units } from "./units.ts";
import { SCHEDULE_INTERVAL_UNIT, SCHEDULE_STATUS } from "./vocabulary.ts";

/**
 * Recurring maintenance (recurring maintenance spec, v1 amendment 2026-10-06;
 * migration `0027`).
 *
 * A **schedule** is a task the lab repeats: "Clean the laser cutter lens"
 * every week, "Empty the dust collector" every month, "Wipe down workbenches"
 * every day. It belongs to a tool, to one unit of a tool, or to nothing at all
 * (general lab upkeep). A SuperMaker checks it off with **Done** and an
 * optional note; that writes one **completion** row and moves `next_due_on`
 * forward by the interval, counted from the day it was done.
 *
 * - **No ticket per occurrence in v1.** A daily task would open a ticket a
 *   day and bury the reported problems the queue exists for. The completion
 *   log is the record.
 * - **Dates are lab dates** (`labToday()`, `LAB_TIMEZONE`), never the server
 *   clock's: a task done at 9pm in New York is done that day, not tomorrow.
 * - **Overdue is derived**, never stored: `next_due_on < labToday()` on an
 *   active schedule.
 * - A tool or unit deleted outright takes its schedules with it (`cascade`);
 *   an archived tool keeps them, and the pages say the tool is archived.
 */
export const maintenanceSchedules = pgTable(
  "maintenance_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null for general lab upkeep, which belongs to no machine. */
    toolId: uuid("tool_id").references(() => tools.id, { onDelete: "cascade" }),
    /** One unit of the tool, or null for the tool as a whole. */
    unitId: uuid("unit_id").references(() => units.id, { onDelete: "cascade" }),
    /** English, like ticket text. ≤ 120 characters (checked by the action). */
    title: text("title").notNull(),
    /** How to do it, the lab's own words. ≤ 2000 characters. */
    instructions: text("instructions"),
    intervalCount: integer("interval_count").notNull(),
    intervalUnit: text("interval_unit").notNull(),
    nextDueOn: date("next_due_on", { mode: "string" }).notNull(),
    lastDoneOn: date("last_done_on", { mode: "string" }),
    status: text("status").notNull().default("active"),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    inListCheck("maintenance_schedules_interval_unit_check", "interval_unit", SCHEDULE_INTERVAL_UNIT),
    inListCheck("maintenance_schedules_status_check", "status", SCHEDULE_STATUS),
    check("maintenance_schedules_interval_count_check", sql`${t.intervalCount} between 1 and 730`),
    // A unit always belongs to a tool; a schedule naming one names both.
    check("maintenance_schedules_unit_needs_tool_check", sql`${t.unitId} is null or ${t.toolId} is not null`),
    index("maintenance_schedules_status_due_idx").on(t.status, t.nextDueOn),
    index("maintenance_schedules_tool_idx").on(t.toolId),
  ]
);

/**
 * One check-off of a schedule: when it was done, what it was due, who did it
 * and what they noted. Append-only. `done_by_name` is a snapshot, so the log
 * still says who did the work after their account is removed (`set null`).
 */
export const maintenanceCompletions = pgTable(
  "maintenance_completions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => maintenanceSchedules.id, { onDelete: "cascade" }),
    doneOn: date("done_on", { mode: "string" }).notNull(),
    /** The due date this check-off answered, so "done 3 days late" can be read later. */
    dueOn: date("due_on", { mode: "string" }).notNull(),
    note: text("note"),
    doneByUserId: userReference("done_by_user_id"),
    doneByName: text("done_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("maintenance_completions_schedule_idx").on(t.scheduleId, t.doneOn)]
);
