import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth.ts";

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
  // A super admin raised somebody's research allowance (bulk intake spec §4.2).
  "allowance.granted",
  // A personal access token or an OAuth grant was created or revoked (MCP
  // access spec §4.2). `detail.kind` says which: "token" or "oauth".
  "token.created",
  "token.revoked",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    // Deferred from Phase 1 to Phase 4's migration, when `user` came to exist.
    // `set null` rather than `cascade`: deleting the person must not delete the
    // record that they changed someone's role.
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
  },
  (t) => [index("audit_events_subject_idx").on(t.subjectType, t.subjectId), index("audit_events_at_idx").on(t.at)]
);
