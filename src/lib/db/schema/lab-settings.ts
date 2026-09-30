import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { userReference } from "./helpers.ts";

/**
 * Settings a lab sets for its own deployment (usage insight spec amendment
 * "Value report"; migration `0024`): one row per key, the value as JSON.
 *
 * The first key is `value_report` — the assumptions behind the value report on
 * `/admin/insights/value` (minutes of staff time a question stands for, the
 * loaded hourly cost, staffed hours, term boundaries, which answers count as
 * handled without staff). The value is validated by the code that reads it
 * (`lib/usage/value/assumptions.ts`), never trusted as stored: a row that no
 * longer parses falls back to the defaults and the page says so.
 *
 * A key-value table rather than a column per setting because a deployment has
 * one of each and they arrive one feature at a time; a new key needs no
 * migration. Written only through the action layer (`insights.set_value_assumptions`).
 * `updated_by` is the staff member who last changed it, `set null` like every
 * actor column. No per-person data about students lives here.
 */
export const labSettings = pgTable("lab_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: userReference("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
