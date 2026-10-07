import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth.ts";

/**
 * Who is on shift (on-shift spec 2026-10-07; migration `0029`).
 *
 * A staff member (anyone holding `shifts.set`: SuperMakers and directors)
 * marks themselves **On shift** until a time they pick. One row per person:
 * marking again replaces it, ending the shift deletes it, and a row whose
 * `ends_at` has passed means nothing. Every reader filters on
 * `ends_at > now`, so a shift ends by itself and no job has to sweep it.
 *
 * **No new personal data.** The row holds an id and two times. What students
 * see is the display name the `user` row already has, shortened to first name
 * and last initial on the server ("Alex M.", `lib/on-shift/names.ts`). Being
 * shown is opt-in: nobody appears unless they marked themselves.
 *
 * `cascade` on the user: a removed person's shift goes with them.
 */
export const staffShifts = pgTable("staff_shifts", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** When the shift ends by itself. Always in the future when written. */
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  /** When this person last marked themselves on shift. */
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
});
