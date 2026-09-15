import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { maintenanceLogs } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import { isUuid } from "./uuid.ts";

/**
 * Maintenance history reads on Postgres (spec §3.10, §4.8).
 *
 * This replaces `fetchMaintenanceLogsByUnit` from `src/lib/notion.ts` behind
 * the `units` capability. Tickets are still *written* to Notion until Phase 3;
 * only the read moved.
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
