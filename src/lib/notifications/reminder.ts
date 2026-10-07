import { getDb } from "../db/client.ts";
import type { Db } from "../db/types.ts";
import { labInstant, labToday } from "../lab-time.ts";
import { enqueueNotification } from "./enqueue.ts";
import { REMINDER_HOUR } from "./limits.ts";
import { dueSubjectIsEmpty, loadDueSubject } from "./subjects.ts";

/**
 * The daily recurring-maintenance reminder (email notifications spec,
 * amendment 2026-10-07): at 08:00 lab time, staff who work maintenance get
 * one email listing the recurring tasks due today and overdue, with a link
 * to the Shift checklist. Nothing due, nothing sent.
 *
 * Hobby allows one cron a day, and it runs at 07:17 UTC (02:17 or 03:17 in
 * New York). So the cron starts a workflow that sleeps until 08:00 lab time,
 * the way the spec's v1.1 digest is planned, rather than adding a second
 * cron. Each day's reminder is one outbox row keyed
 * `maintenance.due:<lab date>`, so a cron retry or a second start sends
 * nothing twice.
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

export type ReminderEnqueue = { queued: true; id: string } | { queued: false; reason: "nothing_due" | "already_queued" };

/**
 * Queue the reminder for `labDate`, unless nothing is due or it is already
 * queued. Read at 08:00, not at cron time: a task checked off overnight is
 * not in the email.
 */
export async function enqueueMaintenanceReminder(labDate: string, options: { db?: Db } = {}): Promise<ReminderEnqueue> {
  const db = options.db ?? (await getDb());
  if (dueSubjectIsEmpty(await loadDueSubject(db, labDate))) return { queued: false, reason: "nothing_due" };
  const row = await enqueueNotification(db, {
    event: "maintenance.due",
    subject: { type: "lab_date", id: labDate },
    surface: "system",
  });
  return row ? { queued: true, id: row.id } : { queued: false, reason: "already_queued" };
}
