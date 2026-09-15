import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Audit events — append-only (spec §4.11). The data layer exposes insert and
 * select on this table and never update or delete. Security-relevant actions
 * only: role changes, bans, publishing, archiving, approving a researched
 * tool, connecting or disconnecting a mirror. Ordinary edits are not logged.
 */
export const AUDIT_ACTIONS = [
  "role.changed",
  "user.banned",
  "tool.published",
  "tool.unpublished",
  "tool.archived",
  "project.published",
  "project.unpublished",
  "pending.approved",
  "mirror.connected",
  "mirror.disconnected",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actorUserId: text("actor_user_id"),
    action: text("action").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
  },
  (t) => [index("audit_events_subject_idx").on(t.subjectType, t.subjectId), index("audit_events_at_idx").on(t.at)]
);
