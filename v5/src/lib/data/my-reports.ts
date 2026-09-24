import { desc, eq } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { feedback, maintenanceLogs, tools } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";

/**
 * A person's own reports — the maintenance tickets and catalogue corrections
 * they filed while signed in (MCP access spec §3.2, `list_my_reports`).
 *
 * **Filtered by the reporter's user id and nothing else**: a report filed
 * anonymously, or by somebody else, never comes back, whatever the caller
 * asks. The rows carry what the reporter already knows — what they wrote, the
 * tool, the status staff set, the resolution — and never another person's
 * name or address.
 *
 * Relative imports with `.ts` extensions, no `@/` alias and no `"server-only"`,
 * like every other module under `src/lib/data/`.
 */

export interface MyTicket {
  id: string;
  title: string;
  tool: string;
  unit: string;
  /** Stored vocabulary: `open`, `in_progress`, `resolved`, `closed`. */
  status: string;
  priority: string | null;
  resolution: string;
  dateReported: string;
  dateResolved: string;
}

export interface MyCorrection {
  id: string;
  tool: string;
  field: string | null;
  issue: string;
  /** Stored vocabulary: `new`, `reviewed`, `fixed`, `dismissed`. */
  status: string;
  filedAt: Date;
}

export interface MyReports {
  tickets: MyTicket[];
  corrections: MyCorrection[];
}

/** How many of each kind one call returns, newest first. */
export const MY_REPORTS_LIMIT = 50;

export async function listMyReports(
  userId: string,
  options: { db?: Db; limit?: number } = {}
): Promise<MyReports> {
  const db = options.db ?? (await getDb());
  const limit = options.limit ?? MY_REPORTS_LIMIT;

  const [ticketRows, correctionRows] = await Promise.all([
    db
      .select({
        id: maintenanceLogs.id,
        title: maintenanceLogs.title,
        liveToolName: tools.name,
        snapshotToolName: maintenanceLogs.toolName,
        unitLabel: maintenanceLogs.unitLabel,
        status: maintenanceLogs.status,
        priority: maintenanceLogs.priority,
        resolution: maintenanceLogs.resolution,
        dateReported: maintenanceLogs.dateReported,
        dateResolved: maintenanceLogs.dateResolved,
      })
      .from(maintenanceLogs)
      .leftJoin(tools, eq(maintenanceLogs.toolId, tools.id))
      .where(eq(maintenanceLogs.reportedByUserId, userId))
      .orderBy(desc(maintenanceLogs.createdAt))
      .limit(limit),
    db
      .select({
        id: feedback.id,
        toolName: tools.name,
        field: feedback.fieldFlagged,
        issue: feedback.issueDescription,
        status: feedback.status,
        filedAt: feedback.createdAt,
      })
      .from(feedback)
      .leftJoin(tools, eq(feedback.toolId, tools.id))
      .where(eq(feedback.reporterUserId, userId))
      .orderBy(desc(feedback.createdAt))
      .limit(limit),
  ]);

  return {
    tickets: ticketRows.map((row) => ({
      id: row.id,
      title: row.title,
      tool: row.liveToolName || row.snapshotToolName || "",
      unit: row.unitLabel || "",
      status: row.status,
      priority: row.priority,
      resolution: row.resolution || "",
      dateReported: row.dateReported || "",
      dateResolved: row.dateResolved || "",
    })),
    corrections: correctionRows.map((row) => ({
      id: row.id,
      tool: row.toolName || "",
      field: row.field,
      issue: row.issue,
      status: row.status,
      filedAt: row.filedAt,
    })),
  };
}
