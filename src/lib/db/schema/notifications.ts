import { boolean, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { inListCheck } from "./checks.ts";
import {
  DELIVERY_REASON,
  DELIVERY_STATUS,
  NOTIFICATION_EVENTS,
  NOTIFICATION_SKIP_REASON,
  NOTIFICATION_STATUS,
  NOTIFICATION_SURFACE,
  type NotificationDelivery,
  type NotificationEvent,
} from "./vocabulary.ts";

/**
 * Email notifications (email notifications spec §4; migration `0030`).
 *
 * Three tables, and **none of them holds an email address or a rendered
 * body.** The address is read from `user` inside the send step and handed
 * straight to the provider; the body is rendered from the subject's current
 * state at send time. Removing a person cascades through all three.
 *
 * - `notifications` is the **outbox**: one row per event, written in the same
 *   transaction as the write that caused it (a ticket insert). Its
 *   `dedupe_key` is unique, so the same event can never be queued twice.
 * - `notification_deliveries` is one row per recipient, and the delivery log.
 *   Its id is the provider's `Idempotency-Key`, and `(notification_id,
 *   user_id)` is unique, so a replayed fan-out inserts nothing new.
 * - `notification_preferences` is a person's choices. v1 writes it only
 *   through the one-click unsubscribe; v1.1 adds the `/account` section.
 */

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    event: text("event").$type<NotificationEvent>().notNull(),
    /** `maintenance_log` + the ticket id; `lab_date` + `YYYY-MM-DD` for the daily reminder. */
    subjectType: text("subject_type"),
    subjectId: text("subject_id"),
    /** Set for personal events (v1.1); null for events fanned out by permission. */
    audienceUserId: text("audience_user_id").references(() => user.id, { onDelete: "cascade" }),
    /** `ticket.filed:<ticketId>`, `maintenance.due:<lab date>`. */
    dedupeKey: text("dedupe_key").notNull().unique(),
    surface: text("surface"),
    status: text("status").notNull().default("queued"),
    /** Why nobody was sent it, when `status` is `skipped`. */
    skipReason: text("skip_reason"),
    /** When the cron backstop restarted this row's run. It restarts a row once, never twice. */
    restartedAt: timestamp("restarted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    inListCheck("notifications_event_check", "event", NOTIFICATION_EVENTS),
    inListCheck("notifications_status_check", "status", NOTIFICATION_STATUS),
    inListCheck("notifications_surface_check", "surface", NOTIFICATION_SURFACE),
    inListCheck("notifications_skip_reason_check", "skip_reason", NOTIFICATION_SKIP_REASON),
    index("notifications_status_created_idx").on(t.status, t.createdAt),
  ]
);

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    /** The provider's `Idempotency-Key`. */
    id: uuid("id").primaryKey().defaultRandom(),
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    reason: text("reason"),
    attempts: integer("attempts").notNull().default(0),
    /** For support with the provider. Never anything that names the person. */
    providerMessageId: text("provider_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    unique("notification_deliveries_notification_user_unique").on(t.notificationId, t.userId),
    inListCheck("notification_deliveries_status_check", "status", DELIVERY_STATUS),
    inListCheck("notification_deliveries_reason_check", "reason", DELIVERY_REASON),
    index("notification_deliveries_status_created_idx").on(t.status, t.createdAt),
  ]
);

export const notificationPreferences = pgTable("notification_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** The master switch (v1.1's `/account`). */
  emailEnabled: boolean("email_enabled").notNull().default(true),
  /** A missing key is the event's default. */
  events: jsonb("events").$type<Partial<Record<NotificationEvent, NotificationDelivery>>>().notNull().default({}),
  /** Set by a hard bounce or complaint (v1.1 webhook). */
  suppressedAt: timestamp("suppressed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
