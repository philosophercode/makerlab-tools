import { sql } from "drizzle-orm";
import { date, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { actorColumns, inListCheck, notionPageId, timestamps } from "./helpers.ts";
import { tools } from "./tools.ts";
import { UNIT_CONDITION, UNIT_STATUS } from "./vocabulary.ts";

/**
 * Units — the physical machines behind a tool (spec §4.5).
 *
 * - `tool_id` is nullable: the live workspace has one unlinked unit, and the
 *   inventory table surfaces unlinked units rather than inventing a tool.
 * - `condition` is nullable: unknown is an honest state; inventing `good` is not.
 * - Serial numbers are unique per tool when present — the "is this a second
 *   unit?" check during intake.
 */
export const units = pgTable(
  "units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    toolId: uuid("tool_id").references(() => tools.id, { onDelete: "cascade" }),
    unitLabel: text("unit_label").notNull(),
    serialNumber: text("serial_number"),
    assetTag: text("asset_tag"),
    status: text("status").notNull().default("available"),
    condition: text("condition"),
    dateAcquired: date("date_acquired", { mode: "string" }),
    notes: text("notes"),
    notionPageId: notionPageId(),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    inListCheck("units_status_check", "status", UNIT_STATUS),
    inListCheck("units_condition_check", "condition", UNIT_CONDITION),
    index("units_tool_idx").on(t.toolId),
    uniqueIndex("units_tool_serial_key")
      .on(t.toolId, sql`lower(${t.serialNumber})`)
      .where(sql`${t.serialNumber} is not null`),
  ]
);
