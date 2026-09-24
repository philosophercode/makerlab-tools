import { desc, eq, sql } from "drizzle-orm";
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
import { isUuid } from "./uuid.ts";

/**
 * Maintenance logs on Postgres — the reads (spec §3.10) and, since Phase 3,
 * the write (§4.8).
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
 * - **Never the reporter's email.** `reported_by_email` is set only from a
 *   resolved session and must not enter a model prompt (spec §8, PII). It is
 *   not selected here at all, so no caller can leak it by accident.
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
