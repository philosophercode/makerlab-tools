import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { inListCheck } from "./checks.ts";
import { AUDIT_SURFACE } from "./vocabulary.ts";

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
  // Somebody signed in through the development-only route, never Google (auth
  // spec amendment 2026-09-24). Only `next dev` on localhost can write it, so
  // one of these in a shared database is itself worth investigating.
  "auth.dev_sign_in",
  // A super admin removed somebody's account (auth spec amendment 2026-09-25).
  // `detail` holds the removed person's name and email — after this event the
  // `user` row is gone and this is where "who was that?" is answered.
  "user.removed",
  // An address was put on, or taken off, `blocked_emails`. `subject_type` is
  // "email" and `subject_id` the normalised address.
  "email.blocked",
  "email.unblocked",
  // A super admin set or cleared somebody's custom title on the People page.
  // `detail` is `{ from, to }`, null meaning the role's default label.
  "user.title_changed",
  // A super admin added somebody on the People page before they had signed in.
  // `detail` is `{ email, name, role, title }` as stored; Google attaches to
  // that row at their first sign-in.
  "user.added",
  // Somebody's display name changed: a super admin on the People page, or the
  // person on `/account` (`lib/people/rename.ts`). `detail` is `{ from, to }`;
  // the actor says which of the two it was.
  "user.name_changed",
  // Taxonomy v2 (spec 2026-09-28 §4.6): a category created by accepting a
  // proposal (`detail.proposalId`), merged into another (`detail.into`,
  // `detail.movedTools`), or retired / restored (`detail.retired`). A rename
  // or a new description is an ordinary edit and is not recorded.
  "category.created",
  "category.merged",
  "category.retired",
  // Somebody turned an email off with the one-click unsubscribe (email
  // notifications spec §3.7). The actor is that person; `detail` is
  // `{ event, from, to }` and never an address. Individual sends are not
  // audited: the delivery table is their log.
  "notification.unsubscribed",
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
    // The actor's name as it was when the event was written (migration `0016`,
    // auth spec amendment 2026-09-25). The foreign key above clears when the
    // person is removed; this is what still says who it was.
    actorName: text("actor_name"),
    action: text("action").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    // Which surface the person used (assistant–GUI parity spec §3.7, migration
    // `0020`): every row before it was the GUI's. The actor is still the
    // person who clicked — an assistant holds no permission of its own.
    surface: text("surface").notNull().default("gui"),
    // The confirmed `action_proposals` row, for a change made from a card. No
    // foreign key: proposals are pruned sooner than audit is kept.
    proposalId: uuid("proposal_id"),
  },
  (t) => [
    index("audit_events_subject_idx").on(t.subjectType, t.subjectId),
    index("audit_events_at_idx").on(t.at),
    inListCheck("audit_events_surface_check", "surface", AUDIT_SURFACE),
  ]
);
