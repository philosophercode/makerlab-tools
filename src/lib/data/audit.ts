import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { auditEvents } from "../db/schema/index.ts";
import type { AuditAction } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";

/**
 * The audit trail (data platform design spec §4.11, Article 5).
 *
 * **Append-only by construction, not by convention.** This module exports one
 * insert and one select and nothing else — no `updateAuditEvent`, no
 * `deleteAuditEvent`, not even a private one. A record of who changed whose
 * role is worth exactly as much as the guarantee that nobody rewrote it, and
 * the cheapest way to make that guarantee reviewable is for the edit to not
 * exist in the codebase. (Postgres privileges would be stronger; the app and
 * the migrations share one connection string, so that is not available here.)
 *
 * **Security-relevant actions only.** `AUDIT_ACTIONS` in `db/schema/audit.ts`
 * is the whole vocabulary: role changes, bans, publishing, archiving, approving
 * a researched tool, connecting a mirror. Ordinary edits are deliberately not
 * logged — a table that records everything is one nobody reads. Phase 4 writes
 * the first two; the rest arrive with the surfaces that perform them.
 *
 * Relative imports with `.ts` extensions, no `@/` alias and no `"server-only"`,
 * like every other module under `src/lib/data/`.
 */

/** One event, in the column shape the table takes. */
export interface NewAuditEvent {
  /**
   * Who did it. `user.id`, and the foreign key means it must name a real row —
   * correct, because in production this comes from a resolved session. Null is
   * accepted for an action the system took on nobody's behalf.
   */
  actorUserId: string | null;
  action: AuditAction;
  /** What kind of thing it happened to: `"user"`, `"tool"`, `"project"`. */
  subjectType: string;
  /** That thing's id, as text — subjects are not all uuids (`user.id` is not). */
  subjectId: string;
  /** Anything worth reading later: the old and new role, a ban reason. */
  detail?: Record<string, unknown> | null;
}

export interface AuditWriteOptions {
  /** A handle to use instead of {@link getDb} — tests pass an isolated one. */
  db?: Db;
}

/**
 * Record one event. `at` is left to the column default so the timestamp is the
 * database's rather than the caller's: a clock skewed by a few seconds on one
 * serverless instance must not reorder the trail.
 *
 * Throws on a database failure. Callers write the event *after* the change it
 * describes has landed, so a throw here means "the change happened but was not
 * recorded" — which is worth failing the action over and saying so, rather than
 * quietly leaving a gap (Article 4).
 */
export async function recordAuditEvent(
  event: NewAuditEvent,
  options: AuditWriteOptions = {}
): Promise<{ id: string }> {
  const db = options.db ?? (await getDb());
  const actorUserId = event.actorUserId || null;

  const [created] = await db
    .insert(auditEvents)
    .values({
      actorUserId,
      // The actor's name as it is now, read in the same statement (auth spec
      // amendment 2026-09-25): the foreign key clears if the person is ever
      // removed, and this is what still says who it was. No caller passes it.
      actorName: actorUserId ? sql`(select "name" from "user" where "id" = ${actorUserId})` : null,
      action: event.action,
      subjectType: event.subjectType,
      subjectId: event.subjectId,
      detail: event.detail ?? null,
    })
    .returning({ id: auditEvents.id });

  return { id: created.id };
}

/** One event as the admin surfaces read it back. */
export interface AuditEventRecord {
  id: string;
  at: Date;
  actorUserId: string | null;
  /**
   * The actor's name when the event was written. With `actorUserId` null and
   * this set, the actor's account has since been removed.
   */
  actorName: string | null;
  action: string;
  subjectType: string;
  subjectId: string;
  detail: Record<string, unknown> | null;
}

export interface ListAuditEventsQuery {
  /** Narrow to one kind of subject — both of these, or neither. */
  subjectType?: string;
  subjectId?: string;
  /** Newest-first cap. Defaults to 100; the trail grows without bound. */
  limit?: number;
  db?: Db;
}

/** How many events one call will return when the caller names no limit. */
export const DEFAULT_AUDIT_LIMIT = 100;

/**
 * Events, newest first. Filtering by subject uses the composite index on
 * `(subject_type, subject_id)`, which is why both are given together or not at
 * all — half of a composite key reads the whole table.
 */
export async function listAuditEvents(
  query: ListAuditEventsQuery = {}
): Promise<AuditEventRecord[]> {
  const db = query.db ?? (await getDb());
  const limit = Math.max(1, query.limit ?? DEFAULT_AUDIT_LIMIT);

  const where =
    query.subjectType && query.subjectId
      ? and(
          eq(auditEvents.subjectType, query.subjectType),
          eq(auditEvents.subjectId, query.subjectId)
        )
      : undefined;

  const rows = await db
    .select()
    .from(auditEvents)
    .where(where)
    .orderBy(desc(auditEvents.at), desc(auditEvents.id))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    at: row.at,
    actorUserId: row.actorUserId,
    actorName: row.actorName ?? null,
    action: row.action,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    detail: row.detail ?? null,
  }));
}
