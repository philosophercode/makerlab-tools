import { sql } from "drizzle-orm";
import { boolean, check, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { inListCheck, timestamps } from "./helpers.ts";
import { DEMO_SIGNUP_ROLES } from "./vocabulary.ts";

/**
 * Demo sign-ups (demo pass spec 2026-10-07 §4; migration `0032`): a visitor
 * from another school who filled in `/demo`, and the demo pass that sign-up
 * holds — one row is both. The pass cookie names a row; the row decides.
 *
 * **Personal data, kept small and kept in.** The name, email and institution
 * are read by exactly two things: the super-admin page under People and its
 * CSV (`users.manage`). The chat reads only the ledger columns
 * (`getDemoPassLedger`), so nothing a visitor typed reaches a model prompt, and
 * no capability reads this table, so nothing reaches MCP. `data:push` leaves it
 * behind (`cron/backup-policy.ts`, `DEPLOYMENT_BOUND`). Retention: 12 months
 * from sign-up (spec §8).
 *
 * - `email` is stored normalised (trimmed, lower-case) and unique: one pass per
 *   address. Signing up again returns the same row unchanged.
 * - The budget is not a column: `DEMO_PASS_BUDGET_USD` is read at each turn,
 *   so the owner can change it for every pass at once. `spent_usd` only grows,
 *   by one atomic increment per charged turn.
 * - No foreign key points here: a demo ticket is flagged
 *   (`maintenance_logs.demo`), not attributed to a sign-up.
 */
export const demoSignups = pgTable(
  "demo_signups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    institution: text("institution").notNull(),
    /** One of `DEMO_SIGNUP_ROLES`, or null when not answered. */
    role: text("role"),
    /** "Do you run or work in a makerspace?" — null when not answered. */
    runsMakerspace: boolean("runs_makerspace"),
    /** "What would you use it for?" — a line or two, or null. */
    useCase: text("use_case"),
    /** May the lab contact them about MakerLAB AI. Unticked by default. */
    consentToContact: boolean("consent_to_contact").notNull().default(false),
    /** Fourteen days after sign-up. Read on every turn: the cookie's own expiry is only a shortcut. */
    passExpiresAt: timestamp("pass_expires_at", { withTimezone: true }).notNull(),
    /** Dollars charged so far — the pass's ledger. */
    spentUsd: numeric("spent_usd", { precision: 12, scale: 6, mode: "number" }).notNull().default(0),
    /** Chat turns charged to the pass. */
    chargedTurns: integer("charged_turns").notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("demo_signups_email_key").on(t.email),
    inListCheck("demo_signups_role_check", "role", DEMO_SIGNUP_ROLES),
    check("demo_signups_spent_check", sql`${t.spentUsd} >= 0`),
  ]
);
