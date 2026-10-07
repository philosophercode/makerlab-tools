import { sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { rawRows } from "../db/raw.ts";
import { maintenanceReminderItems } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import { labInstant, labToday } from "../lab-time.ts";
import { enqueueNotification } from "./enqueue.ts";
import { REMINDER_HOUR } from "./limits.ts";

/**
 * The recurring-maintenance reminder (email notifications spec, amendment
 * "The reminder follows each task's cadence"): when a recurring task comes
 * due, staff who work maintenance are emailed about it **once for that due
 * date**, with a link to the Shift checklist. A task that stays overdue is
 * not emailed again; checked off with **Done**, its next due date is emailed
 * when it arrives. Not a daily list of everything outstanding.
 *
 * Hobby allows one cron a day, and it runs at 07:17 UTC (02:17 or 03:17 in
 * New York). So the cron starts a workflow that sleeps until 08:00 lab time
 * and then sends one email naming every task newly due since the last one
 * (usually the tasks due that day). Which task, on which due date, an email
 * already named is kept in `maintenance_reminder_items`, keyed by the two,
 * so nothing is named twice. The day's email is one outbox row keyed
 * `maintenance.due:<lab date>`, so a cron retry or a second start sends
 * nothing twice either; a task that comes due after the day's email waits
 * for the next day's.
 */

export { REMINDER_HOUR };

export interface ReminderPlan {
  /** Today in the lab's timezone, `YYYY-MM-DD`. */
  labDate: string;
  /** How long to wait for 08:00 lab time; 0 when it has already passed (a late or manual run sends at once). */
  waitMs: number;
}

/**
 * Today's lab date and how long until `hour` (08:00) on it. Read in a step,
 * so the workflow body never reads the clock.
 */
export function planReminder(now: Date = new Date(), hour: number = REMINDER_HOUR): ReminderPlan {
  const labDate = labToday(now);
  const sendAt = labInstant(labDate, hour, 0);
  return { labDate, waitMs: Math.max(0, sendAt.getTime() - now.getTime()) };
}

export type ReminderEnqueue =
  | { queued: true; id: string; tasks: number }
  | { queued: false; reason: "nothing_due" | "already_queued" };

/**
 * Active recurring tasks due on `labDate` or before it that no reminder has
 * named for their current due date: the tasks that came due since the last
 * email (a missed day, or a task set up already overdue, included).
 */
export async function listNewlyDue(db: Db, labDate: string): Promise<Array<{ scheduleId: string; dueOn: string }>> {
  const rows = await rawRows<{ id: string; next_due_on: string | Date }>(
    db,
    sql`select s.id, s.next_due_on
          from maintenance_schedules s
         where s.status = 'active'
           and s.next_due_on <= ${labDate}::date
           and not exists (
             select 1 from maintenance_reminder_items i
              where i.schedule_id = s.id and i.due_on = s.next_due_on
           )
         order by s.next_due_on, s.title`
  );
  return rows.map((row) => ({ scheduleId: row.id, dueOn: toDateString(row.next_due_on) }));
}

function toDateString(value: string | Date): string {
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

/**
 * Queue the day's reminder for `labDate`: one outbox row naming every task
 * newly due, written with those names in one transaction. Nothing newly due
 * (every due task was already named, or nothing is due), nothing queued.
 * Read at 08:00, not at cron time: a task checked off overnight is not in
 * the email.
 */
export async function enqueueMaintenanceReminder(labDate: string, options: { db?: Db } = {}): Promise<ReminderEnqueue> {
  const db = options.db ?? (await getDb());
  return db.transaction(async (tx) => {
    const newlyDue = await listNewlyDue(tx, labDate);
    if (newlyDue.length === 0) return { queued: false, reason: "nothing_due" } as const;
    const row = await enqueueNotification(tx, {
      event: "maintenance.due",
      subject: { type: "lab_date", id: labDate },
      surface: "system",
    });
    // Already queued today: the tasks that came due since wait for tomorrow's.
    if (!row) return { queued: false, reason: "already_queued" } as const;
    await tx
      .insert(maintenanceReminderItems)
      .values(newlyDue.map((item) => ({ scheduleId: item.scheduleId, dueOn: item.dueOn, notificationId: row.id })))
      .onConflictDoNothing();
    return { queued: true, id: row.id, tasks: newlyDue.length } as const;
  });
}
