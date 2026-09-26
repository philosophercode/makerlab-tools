import { desc, eq, or, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { getDb } from "../db/client.ts";
import { maintenanceLogs, tools, units } from "../db/schema/index.ts";
import {
  MAINTENANCE_PRIORITY,
  MAINTENANCE_STATUS,
  MAINTENANCE_TYPE,
  isOneOf,
} from "../db/schema/vocabulary.ts";
import type { Db } from "../db/types.ts";
import { labToday } from "../lab-time.ts";
import { claimAttachments } from "./attachments.ts";
import { rankByVocabulary } from "./rank.ts";
import { isUuid } from "./uuid.ts";

/**
 * Maintenance logs on Postgres — the reads (spec §3.10), the filing write
 * (§4.8) since Phase 3, and since Phase 5 the queue `/admin/maintenance` works
 * them in (§5.6).
 *
 * The write lives beside the read on purpose: this module is already this
 * table's data access, and the two share the vocabulary translation that is
 * the easiest thing in the whole path to get wrong in one direction only.
 *
 * Two rules shape what comes back:
 *
 * - **Display strings, not stored values.** The column holds `issue_report`;
 *   the assistant has always seen `"Issue Report"`, and the tool descriptions
 *   and prompt fragments say so. {@link toDisplayLabel} is the exact inverse of
 *   the import's `toStoredValue`, so a value that survived the import round
 *   trips back to the words Notion showed.
 * - **The reporter's email is selected by exactly one read.**
 *   `reported_by_email` is set only from a resolved session and must not enter
 *   a model prompt (spec §8, PII), so the history read — whose rows a model
 *   sees — does not select the column at all. (The Notion mirror does carry it,
 *   per the 2026-09-23 amendment, but through its own select in
 *   `mirror/source.ts`, not through this module.) Phase 5's
 *   {@link listMaintenanceQueue} does, because `/admin/maintenance` is gated on
 *   `maintenance.manage` and answering a confusing ticket means writing back to
 *   the person who filed it. Which read a caller picks is therefore the whole
 *   of that decision, which is why they are two functions and not one with a
 *   flag.
 *
 * Relative imports with `.ts` extensions and no `@/` alias, and no
 * `"server-only"`: `scripts/` loads these modules under plain Node.
 */

/** One maintenance log, flattened and translated into display text. */
export interface MaintenanceHistoryEntry {
  id: string;
  title: string;
  /** `"Issue Report"`, `"Repair"`, … — empty when the log has none. */
  type: string;
  /** `"Critical"`, `"High"`, … — empty when the log has none. */
  priority: string;
  /** `"Open"`, `"In Progress"`, … — empty when the log has none. */
  status: string;
  description: string;
  resolution: string;
  dateReported: string;
  dateResolved: string;
  /** The reporter's name. Deliberately never their email (spec §8). */
  reportedByName: string;
}

export interface MaintenanceQueryOptions {
  /** A handle to use instead of {@link getDb} — tests pass an isolated one. */
  db?: Db;
  /** How many of the most recent logs to read. */
  limit?: number;
}

/**
 * A history is for a person (or a model) to read, not an archive to page
 * through, so a read is always bounded (Article 4). Callers that show fewer
 * pass their own, smaller limit.
 */
const DEFAULT_LIMIT = 50;

/**
 * The most recent maintenance logs filed against one unit, newest first.
 *
 * Empty for a unit with no history, and for anything that is not a uuid — a
 * unit label that failed to resolve returns nothing rather than reaching
 * Postgres as a bad uuid cast.
 */
export async function listMaintenanceHistoryForUnit(
  unitId: string,
  options: MaintenanceQueryOptions = {}
): Promise<MaintenanceHistoryEntry[]> {
  if (!isUuid(unitId)) return [];

  const db = options.db ?? (await getDb());
  const rows = await db
    .select({
      id: maintenanceLogs.id,
      title: maintenanceLogs.title,
      type: maintenanceLogs.type,
      priority: maintenanceLogs.priority,
      status: maintenanceLogs.status,
      description: maintenanceLogs.description,
      resolution: maintenanceLogs.resolution,
      dateReported: maintenanceLogs.dateReported,
      dateResolved: maintenanceLogs.dateResolved,
      reportedByName: maintenanceLogs.reportedByName,
    })
    .from(maintenanceLogs)
    .where(eq(maintenanceLogs.unitId, unitId))
    // `date_reported` is nullable and most imported logs have one; a log with
    // no date sorts last rather than ahead of everything, which is where a
    // descending sort would otherwise put it.
    .orderBy(
      sql`${maintenanceLogs.dateReported} desc nulls last`,
      desc(maintenanceLogs.createdAt)
    )
    .limit(options.limit ?? DEFAULT_LIMIT);

  return rows.map(toMaintenanceHistoryEntry);
}

/** One line of a tool's public maintenance history (UI system phase 5a). */
export interface ToolMaintenanceEntry {
  id: string;
  /** The unit's label, or "" for a log filed against the tool as a whole. */
  unitLabel: string;
  title: string;
  /** Display text, as {@link toDisplayLabel} gives it; "" when not recorded. */
  type: string;
  status: string;
  /** ISO day; "" when not recorded. */
  dateReported: string;
  dateResolved: string;
}

/**
 * The most recent maintenance logs for a tool, newest first — the tool page's
 * "Maintenance history": logs filed against any of its units, and logs whose
 * `tool_id` names it directly (a ticket with no unit, or one whose unit was
 * retired — `tool_id` and `unit_label` are write-time snapshots that outlive
 * the unit, §4.8). A **public** read: it selects no reporter
 * name, no email and no description, the same line MCP draws for an anonymous
 * caller (maintenance history carries names only for `maintenance.manage`).
 */
export async function listMaintenanceHistoryForTool(
  toolId: string,
  options: MaintenanceQueryOptions = {}
): Promise<ToolMaintenanceEntry[]> {
  if (!isUuid(toolId)) return [];
  const db = options.db ?? (await getDb());
  const rows = await db
    .select({
      id: maintenanceLogs.id,
      unitLabel: sql<string | null>`coalesce(${units.unitLabel}, ${maintenanceLogs.unitLabel})`,
      title: maintenanceLogs.title,
      type: maintenanceLogs.type,
      status: maintenanceLogs.status,
      dateReported: maintenanceLogs.dateReported,
      dateResolved: maintenanceLogs.dateResolved,
    })
    .from(maintenanceLogs)
    .leftJoin(units, eq(maintenanceLogs.unitId, units.id))
    .where(or(eq(maintenanceLogs.toolId, toolId), eq(units.toolId, toolId)))
    .orderBy(sql`${maintenanceLogs.dateReported} desc nulls last`, desc(maintenanceLogs.createdAt))
    .limit(options.limit ?? 10);
  return rows.map((row) => ({
    id: row.id,
    unitLabel: row.unitLabel ?? "",
    title: row.title,
    type: toDisplayLabel(row.type),
    status: toDisplayLabel(row.status),
    dateReported: row.dateReported ?? "",
    dateResolved: row.dateResolved ?? "",
  }));
}

/** The columns {@link listMaintenanceHistoryForUnit} selects, before translation. */
export interface MaintenanceLogRow {
  id: string;
  title: string;
  type: string | null;
  priority: string | null;
  status: string | null;
  description: string | null;
  resolution: string | null;
  dateReported: string | null;
  dateResolved: string | null;
  reportedByName: string | null;
}

/**
 * Row → entry. Every absent value becomes `""` rather than null: these strings
 * are read by a model, and an empty string reads as "not recorded" where a
 * `null` reads as a value.
 */
export function toMaintenanceHistoryEntry(row: MaintenanceLogRow): MaintenanceHistoryEntry {
  return {
    id: row.id,
    title: row.title,
    type: toDisplayLabel(row.type),
    priority: toDisplayLabel(row.priority),
    status: toDisplayLabel(row.status),
    description: row.description || "",
    resolution: row.resolution || "",
    dateReported: row.dateReported || "",
    dateResolved: row.dateResolved || "",
    reportedByName: row.reportedByName || "",
  };
}

/**
 * `in_progress` → `"In Progress"`. The inverse of the import's `toStoredValue`,
 * which lower-cased Notion's option names and turned spaces into underscores,
 * so every vocabulary value that came through the import maps back to the words
 * the workspace used.
 */
export function toDisplayLabel(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * `"In Progress"` → `in_progress`, but only when the result is in `allowed`.
 *
 * The exact inverse of {@link toDisplayLabel}, and the seam Phase 3 needed:
 * `report_issue`'s input schema is display-cased because it was written against
 * Notion's select options, while the CHECK constraints store snake_case. A
 * value that does not map to a known one comes back null rather than being
 * written, because a `text` column with a CHECK rejects the *whole insert* — and
 * losing a student's report of an unsafe machine to a priority spelled oddly is
 * exactly the wrong failure (Article 4).
 */
export function toStoredValue<const T extends readonly string[]>(
  label: string | null | undefined,
  allowed: T
): T[number] | null {
  if (!label) return null;
  const candidate = label.trim().toLowerCase().replace(/\s+/g, "_");
  return isOneOf(allowed, candidate) ? candidate : null;
}

// ── Filing a ticket (spec §4.8) ─────────────────────────────────────

/** A validated ticket, as the `maintenance` capability hands one over. */
export interface NewMaintenanceLog {
  title: string;
  description?: string | null;
  /** Display-cased or stored; anything unrecognised is stored as null. */
  type?: string | null;
  priority?: string | null;
  status?: string | null;
  /** The catalogue unit the report is about, when one resolved. */
  unitId?: string | null;
  reportedByName?: string | null;
  /** **Session only.** There is deliberately no request field that reaches this. */
  reportedByEmail?: string | null;
  reportedByUserId?: string | null;
  /** `attachments.id`s uploaded for this report, in display order. */
  photoAttachmentIds?: readonly string[];
}

export interface CreatedMaintenanceLog {
  id: string;
  /** The tool copied from the unit, when the unit resolved. */
  toolId: string | null;
  toolName: string | null;
  unitLabel: string | null;
  /** The date stored, in `LAB_TIMEZONE`. */
  dateReported: string;
  /** How many of {@link NewMaintenanceLog.photoAttachmentIds} actually attached. */
  photosAttached: number;
}

export interface MaintenanceWriteOptions {
  /** A handle to use instead of {@link getDb} — tests pass an isolated one. */
  db?: Db;
}

/**
 * File one maintenance ticket.
 *
 * Everything the ticket needs to stay readable after the unit is retired is
 * copied in at write time (§4.8): the unit's `tool_id`, and `tool_name` /
 * `unit_label` as snapshots. A unit that does not resolve is not an error —
 * most live logs have no unit at all, and a ticket with no target is still a
 * ticket.
 *
 * The insert and the photo claim share one transaction, so a ticket that fails
 * to write cannot leave its photos pointing at a row nobody has.
 *
 * Throws on a database failure. The caller reports that to the student as a
 * failure to file — never as a filed ticket (Article 4).
 */
export async function createMaintenanceLog(
  input: NewMaintenanceLog,
  options: MaintenanceWriteOptions = {}
): Promise<CreatedMaintenanceLog> {
  const db = options.db ?? (await getDb());
  const target = await findUnitTarget(db, input.unitId);
  const dateReported = labToday();

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(maintenanceLogs)
      .values({
        title: input.title,
        description: input.description || null,
        type: toStoredValue(input.type, MAINTENANCE_TYPE),
        priority: toStoredValue(input.priority, MAINTENANCE_PRIORITY),
        // `status` is not null in the schema; an unrecognised one opens the
        // ticket rather than refusing it.
        status: toStoredValue(input.status, MAINTENANCE_STATUS) ?? "open",
        unitId: target?.unitId ?? null,
        toolId: target?.toolId ?? null,
        toolName: target?.toolName ?? null,
        unitLabel: target?.unitLabel ?? null,
        reportedByName: input.reportedByName || null,
        reportedByEmail: input.reportedByEmail || null,
        reportedByUserId: input.reportedByUserId || null,
        dateReported,
        // Who filed it, for the audit columns every table carries. Null for an
        // anonymous report, which stays a first-class path.
        createdBy: input.reportedByUserId || null,
        updatedBy: input.reportedByUserId || null,
      })
      .returning({ id: maintenanceLogs.id });

    const photosAttached = await claimAttachments(tx, input.photoAttachmentIds ?? [], {
      ownerType: "maintenance_log",
      ownerId: row.id,
    });

    return {
      id: row.id,
      toolId: target?.toolId ?? null,
      toolName: target?.toolName ?? null,
      unitLabel: target?.unitLabel ?? null,
      dateReported,
      photosAttached,
    };
  });
}

interface UnitTarget {
  unitId: string;
  toolId: string | null;
  toolName: string | null;
  unitLabel: string | null;
}

/** The unit, its tool and both display names — or null for anything unresolvable. */
async function findUnitTarget(db: Db, unitId: string | null | undefined): Promise<UnitTarget | null> {
  if (!unitId || !isUuid(unitId)) return null;

  const [row] = await db
    .select({
      unitId: units.id,
      unitLabel: units.unitLabel,
      toolId: units.toolId,
      toolName: tools.name,
    })
    .from(units)
    .leftJoin(tools, eq(units.toolId, tools.id))
    .where(eq(units.id, unitId))
    .limit(1);

  return row ?? null;
}

// ── The queue (spec §5.6, §9) ───────────────────────────────────────

/**
 * One ticket as `/admin/maintenance` works it.
 *
 * **Stored values, not display labels** — the opposite of
 * {@link MaintenanceHistoryEntry}, and for the opposite reason. That one is
 * read by a model, so `in_progress` becomes `"In Progress"` at the boundary.
 * This one is read by a person through `next-intl`, which needs the machine
 * value to look a message up by (`admin.maintenance.status.in_progress`) and
 * the `<select>` needs it to post back. Translating here would force the page
 * to translate back before it could write, and a round trip through display
 * text is exactly where a vocabulary drifts.
 */
export interface MaintenanceQueueEntry {
  id: string;
  title: string;
  description: string;
  resolution: string;
  /** Stored vocabulary values, or null where the ticket records none. */
  type: string | null;
  priority: string | null;
  status: string;
  /** The tool, when the ticket names a unit that still belongs to one. */
  toolId: string | null;
  toolSlug: string | null;
  /** The live tool name, or the snapshot taken when the ticket was filed. */
  toolName: string;
  unitId: string | null;
  unitLabel: string;
  reportedByName: string;
  /**
   * The reporter's address, **only on this projection**.
   *
   * {@link listMaintenanceHistoryForUnit} deliberately does not select this
   * column, because its rows reach a model prompt (§8). (The Notion mirror
   * carries reporter emails since the 2026-09-23 amendment, but it selects
   * them in `mirror/source.ts`; neither read here feeds it.)
   * This read has one caller — a page gated on `maintenance.manage` — and the
   * first thing an admin does with a confusing ticket is ask the person who
   * filed it. Showing a name they cannot reach is a queue that sends them back
   * to their inbox to guess. It goes no further than the page, exactly as
   * `listUsers`' emails do.
   */
  reportedByEmail: string;
  assignedToUserId: string | null;
  assignedToName: string;
  dateReported: string;
  dateResolved: string;
  createdAt: Date;
}

/**
 * How many tickets one queue read returns.
 *
 * Bounded like every other read here (Article 4). A lab with more than two
 * hundred tickets on file has a backlog problem that a longer page does not
 * solve, and the filters on the page narrow what is shown from these rows
 * without another round trip.
 */
const QUEUE_LIMIT = 200;

/**
 * Open work first, then the worst of it — the order the queue is worked in.
 *
 * `MAINTENANCE_STATUS` is declared in the order work moves through it (open →
 * closed), so its own index is the rank. `MAINTENANCE_PRIORITY` is declared
 * *ascending* in severity (low → critical), so it is reversed: a queue that put
 * the low-priority tickets at the top would be worse than no order at all. The
 * two lists are the source either way, so a value added to one sorts where it
 * was declared rather than silently last.
 */
const STATUS_RANK = rankByVocabulary(maintenanceLogs.status, MAINTENANCE_STATUS);
const PRIORITY_RANK = rankByVocabulary(
  maintenanceLogs.priority,
  [...MAINTENANCE_PRIORITY].reverse()
);

/**
 * Every ticket, the open ones first (spec §5.6).
 *
 * Ranked by {@link STATUS_RANK} then {@link PRIORITY_RANK}, which puts the
 * queue in the order somebody with ten minutes needs it: everything still open,
 * critical first. A ticket with no priority sorts after the ones that have one
 * rather than ahead of them, and the report date breaks any remaining tie.
 *
 * Resolved and closed tickets stay in the list: the page folds them behind a
 * disclosure, because "what did we do about the last one of these" is the
 * question a resolution field exists to answer. **One statement** whatever the
 * size of the queue — the join carries the tool, and nothing is resolved per
 * row (Article 4).
 */
export async function listMaintenanceQueue(
  options: MaintenanceQueryOptions = {}
): Promise<MaintenanceQueueEntry[]> {
  const db = options.db ?? (await getDb());

  const rows = await db
    .select({
      id: maintenanceLogs.id,
      title: maintenanceLogs.title,
      description: maintenanceLogs.description,
      resolution: maintenanceLogs.resolution,
      type: maintenanceLogs.type,
      priority: maintenanceLogs.priority,
      status: maintenanceLogs.status,
      toolId: maintenanceLogs.toolId,
      toolSlug: tools.slug,
      liveToolName: tools.name,
      snapshotToolName: maintenanceLogs.toolName,
      unitId: maintenanceLogs.unitId,
      unitLabel: maintenanceLogs.unitLabel,
      reportedByName: maintenanceLogs.reportedByName,
      reportedByEmail: maintenanceLogs.reportedByEmail,
      assignedToUserId: maintenanceLogs.assignedToUserId,
      assignedToName: maintenanceLogs.assignedToName,
      dateReported: maintenanceLogs.dateReported,
      dateResolved: maintenanceLogs.dateResolved,
      createdAt: maintenanceLogs.createdAt,
    })
    .from(maintenanceLogs)
    .leftJoin(tools, eq(maintenanceLogs.toolId, tools.id))
    .orderBy(
      STATUS_RANK,
      PRIORITY_RANK,
      sql`${maintenanceLogs.dateReported} desc nulls last`,
      desc(maintenanceLogs.createdAt)
    )
    .limit(options.limit ?? QUEUE_LIMIT);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description || "",
    resolution: row.resolution || "",
    type: row.type,
    priority: row.priority,
    status: row.status,
    toolId: row.toolId,
    toolSlug: row.toolSlug,
    // The live name when the tool still exists, the snapshot when it does not:
    // a renamed tool should read as itself, and an archived one should still
    // say which machine the ticket was about (§4.8).
    toolName: row.liveToolName || row.snapshotToolName || "",
    unitId: row.unitId,
    unitLabel: row.unitLabel || "",
    reportedByName: row.reportedByName || "",
    reportedByEmail: row.reportedByEmail || "",
    assignedToUserId: row.assignedToUserId,
    assignedToName: row.assignedToName || "",
    dateReported: row.dateReported || "",
    dateResolved: row.dateResolved || "",
    createdAt: row.createdAt,
  }));
}

// ── Working a ticket (spec §5.6) ────────────────────────────────────

/** What `/admin/maintenance` can change about a ticket. */
export interface MaintenanceLogPatch {
  /** One of `MAINTENANCE_STATUS`, stored-cased. */
  status?: string;
  /** One of `MAINTENANCE_PRIORITY`, or null to clear it. */
  priority?: string | null;
  /** `user.id`, or null to unassign. The name is stored beside it. */
  assignedToUserId?: string | null;
  assignedToName?: string | null;
  resolution?: string | null;
}

export type MaintenanceWriteResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "invalid_field" };

/**
 * Change one ticket's status, priority, assignee or resolution.
 *
 * **`date_resolved` is computed in SQL, from `labToday()`.** A ticket that
 * reaches `resolved` or `closed` is dated the day it happened *in the lab's
 * timezone* (§4.8) — a Vercel function runs in UTC, so a ticket closed at 9pm
 * in New York would otherwise be dated tomorrow, which is a day staff would not
 * find it under. `coalesce` keeps the first resolution date rather than moving
 * it every time somebody edits the note afterwards, and re-opening a ticket
 * clears the date, because a ticket that is open was not resolved.
 *
 * **No revision token here, unlike the tool editor.** These are single-field
 * changes to one ticket from one person's screen; there is nothing to lose to
 * a concurrent write but a status somebody can set again in one click, and a
 * conflict dialogue on a queue somebody is trying to clear in ten minutes costs
 * more than it protects. The tool editor's fields are a form full of typing,
 * which is a different bargain (§5.3(4)).
 *
 * Vocabulary is checked here rather than by the CHECK constraint, which rejects
 * the whole statement with a message no page can render.
 *
 * Throws on a database failure; the caller reports that as `failed`.
 */
export async function updateMaintenanceLog(
  logId: string,
  patch: MaintenanceLogPatch,
  options: MaintenanceWriteOptions & { actorUserId?: string | null } = {}
): Promise<MaintenanceWriteResult> {
  if (!isUuid(logId)) return { ok: false, reason: "not_found" };

  // `PgUpdateSetSource` rather than `Partial<$inferInsert>`, for the reason
  // `tools.ts` gives: `date_resolved` is computed by an expression, and only
  // this type admits raw SQL as a column value.
  const values: PgUpdateSetSource<typeof maintenanceLogs> = {
    updatedBy: options.actorUserId ?? null,
  };

  if (patch.status !== undefined) {
    if (!isOneOf(MAINTENANCE_STATUS, patch.status)) return { ok: false, reason: "invalid_field" };
    values.status = patch.status;
    const settled = patch.status === "resolved" || patch.status === "closed";
    values.dateResolved = settled
      ? sql`coalesce(${maintenanceLogs.dateResolved}, ${labToday()}::date)`
      : null;
  }

  if (patch.priority !== undefined) {
    if (patch.priority !== null && !isOneOf(MAINTENANCE_PRIORITY, patch.priority)) {
      return { ok: false, reason: "invalid_field" };
    }
    values.priority = patch.priority;
  }

  if (patch.assignedToUserId !== undefined) values.assignedToUserId = patch.assignedToUserId || null;
  if (patch.assignedToName !== undefined) values.assignedToName = patch.assignedToName || null;
  if (patch.resolution !== undefined) values.resolution = patch.resolution || null;

  const db = options.db ?? (await getDb());
  const rows = await db
    .update(maintenanceLogs)
    .set(values)
    .where(eq(maintenanceLogs.id, logId))
    .returning({ id: maintenanceLogs.id });

  return rows.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}
