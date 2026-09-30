import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth.ts";

/**
 * Addresses that may not sign up (auth spec amendment 2026-09-25, "Remove a
 * person, and block an address"; migration `0016`).
 *
 * A row is written when a super admin removes somebody and ticks "Also block
 * this email from signing up again", and deleted by **Unblock** — the list is
 * state, not history; `email.blocked` / `email.unblocked` in `audit_events`
 * are the history. Sign-in reads it in `databaseHooks.user.create.before`, so a
 * blocked address never becomes a row at all.
 *
 * - `email` is the key, stored normalised (trimmed, lower-case — `normalizeEmail`).
 * - `blocked_by` is `set null` like every other actor column: removing the
 *   person who blocked an address must not unblock it.
 * - An `AUTH_SUPER_ADMIN_EMAILS` address is never written here by the app, and
 *   a row naming one is ignored at sign-in: the floor outranks the list.
 */
export const blockedEmails = pgTable("blocked_emails", {
  email: text("email").primaryKey(),
  reason: text("reason"),
  blockedBy: text("blocked_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
