import { eq, sql } from "drizzle-orm";
import { rawRows } from "../db/raw.ts";
import { maintenanceLogs, tools, units } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import { overdueDays } from "../maintenance/interval.ts";

/**
 * What a template is rendered from, read at send time (email notifications
 * spec §3.3 step 3, §8 PII).
 *
 * **These loaders never select an email address.** `listMaintenanceQueue`
 * selects the reporter's address for `/admin/maintenance`; a staff email
 * shows the reporter's display name only, so it has its own read that does
 * not.
 */

export interface TicketSubject {
  id: string;
  title: string;
  description: string;
  /** Stored vocabulary: `critical`, `high`, `medium`, `low`, or null. */
  priority: string | null;
  status: string;
  /** The live tool name, else the snapshot taken when the ticket was filed; "" for none. */
  toolName: string;
  unitLabel: string;
  /** The reporter's display name, "" when they gave none. */
  reporterName: string;
  /** True when a signed-in person filed it (the name is verified). */
  reporterSignedIn: boolean;
  createdAt: Date;
}

/** One ticket for its `ticket.filed` email, or null when it is gone. */
export async function loadTicketSubject(db: Db, ticketId: string): Promise<TicketSubject | null> {
  const [row] = await db
    .select({
      id: maintenanceLogs.id,
      title: maintenanceLogs.title,
      description: maintenanceLogs.description,
      priority: maintenanceLogs.priority,
      status: maintenanceLogs.status,
      toolName: sql<string | null>`coalesce(${tools.name}, ${maintenanceLogs.toolName})`,
      unitLabel: sql<string | null>`coalesce(${units.unitLabel}, ${maintenanceLogs.unitLabel})`,
      reporterName: maintenanceLogs.reportedByName,
      reporterUserId: maintenanceLogs.reportedByUserId,
      createdAt: maintenanceLogs.createdAt,
    })
    .from(maintenanceLogs)
    .leftJoin(units, eq(units.id, maintenanceLogs.unitId))
    .leftJoin(tools, eq(tools.id, sql`coalesce(${units.toolId}, ${maintenanceLogs.toolId})`))
    .where(eq(maintenanceLogs.id, ticketId))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? "",
    priority: row.priority,
    status: row.status,
    toolName: row.toolName ?? "",
    unitLabel: row.unitLabel ?? "",
    reporterName: row.reporterName ?? "",
    reporterSignedIn: Boolean(row.reporterUserId),
    createdAt: row.createdAt,
  };
}

/** A ticket is worth an email only while somebody still has to act on it (§5.2). */
export function ticketStillOpen(subject: TicketSubject | null): subject is TicketSubject {
  return subject !== null && (subject.status === "open" || subject.status === "in_progress");
}

export interface DueTaskLine {
  title: string;
  /** "" for general lab upkeep. */
  toolName: string;
  unitLabel: string;
  dueOn: string;
  /** 0 when due today. */
  overdueDays: number;
}

export interface DueSubject {
  labDate: string;
  /** Came due before `labDate` and not named until now (a missed day, or a task set up already overdue). */
  overdue: DueTaskLine[];
  dueToday: DueTaskLine[];
}

/**
 * The tasks one reminder named (`maintenance_reminder_items`, amendment "The
 * reminder follows each task's cadence"), as they stand now: a task checked
 * off since, paused or archived drops out, so an email sent late never asks
 * for work already done. `labDate` is the reminder's day.
 */
export async function loadDueSubject(db: Db, notificationId: string, labDate: string): Promise<DueSubject> {
  const rows = await rawRows<{ title: string; tool_name: string | null; unit_label: string | null; due_on: string | Date }>(
    db,
    sql`select s.title, t.name as tool_name, u.unit_label, i.due_on
          from maintenance_reminder_items i
          join maintenance_schedules s on s.id = i.schedule_id
          left join tools t on t.id = s.tool_id
          left join units u on u.id = s.unit_id
         where i.notification_id = ${notificationId}::uuid
           and s.status = 'active'
           and s.next_due_on = i.due_on
         order by i.due_on, s.title`
  );
  const lines = rows.map((row) => {
    const dueOn = typeof row.due_on === "string" ? row.due_on.slice(0, 10) : row.due_on.toISOString().slice(0, 10);
    return {
      title: row.title,
      toolName: row.tool_name ?? "",
      unitLabel: row.unit_label ?? "",
      dueOn,
      overdueDays: overdueDays(dueOn, labDate),
    };
  });
  return {
    labDate,
    overdue: lines.filter((line) => line.overdueDays > 0),
    dueToday: lines.filter((line) => line.overdueDays === 0),
  };
}

/** True when the reminder has nothing to say, which means it is not sent. */
export function dueSubjectIsEmpty(subject: DueSubject): boolean {
  return subject.overdue.length === 0 && subject.dueToday.length === 0;
}
