import { sleep } from "workflow";
import type { DeliveryOutcome } from "../lib/notifications/deliver.ts";
import { REMINDER_HOUR } from "../lib/notifications/limits.ts";
import {
  enqueueReminderStep,
  fanOutStep,
  finishNotificationStep,
  planReminderStep,
  sendDeliveryStep,
} from "../lib/notifications/steps.ts";

/**
 * The email notification workflows (email notifications spec §3.3; amendment
 * 2026-10-07).
 *
 * - {@link deliverNotification}: one outbox row, delivered. Started after the
 *   ticket's transaction commits (`requestNotificationDelivery`) and by the
 *   cron backstop for a row whose run never started.
 * - {@link maintenanceReminder}: the daily recurring-maintenance reminder.
 *   Started by the daily cron at 07:17 UTC; sleeps until 08:00 lab time,
 *   queues the day's row (unless nothing is due) and delivers it the same way.
 *
 * **Deterministic for replay.** The body is replayed from the run's event log
 * after every step, so it reads no clock and draws no random number (the
 * reminder's wait is computed in a step), and sends are sequential, one step
 * per recipient: with a handful of staff that is seconds, and it keeps the
 * run far under the provider's per-second limit (Article 4).
 */

export interface DeliverySummary {
  notificationId: string;
  outcomes: Array<DeliveryOutcome["state"] | "error">;
}

/** Deliver one queued notification to every recipient, one after another. */
export async function deliverNotification(notificationId: string): Promise<DeliverySummary> {
  "use workflow";
  return deliverAll(notificationId);
}

export type ReminderSummary =
  | { labDate: string; queued: false; reason: "nothing_due" | "already_queued" }
  | { labDate: string; queued: true; delivery: DeliverySummary };

/**
 * Wait for 08:00 lab time, then remind staff of the recurring tasks due today
 * and overdue. `hour` is the lab-clock hour to send at; only the in-process
 * test passes another one, so it need not wait.
 */
export async function maintenanceReminder(hour: number = REMINDER_HOUR): Promise<ReminderSummary> {
  "use workflow";
  const plan = await planReminderStep(hour);
  if (plan.waitMs > 0) await sleep(plan.waitMs);
  const queued = await enqueueReminderStep(plan.labDate);
  if (!queued.queued) return { labDate: plan.labDate, queued: false, reason: queued.reason };
  return { labDate: plan.labDate, queued: true, delivery: await deliverAll(queued.id) };
}

/**
 * Fan out, send each, finish. A plain function in workflow scope, not a step.
 * One recipient's send that gave up (its step's retries spent on a database
 * outage) does not stop the next: it stays `sending` for the cron backstop.
 */
async function deliverAll(notificationId: string): Promise<DeliverySummary> {
  const ids = await fanOutStep(notificationId);
  const outcomes: DeliverySummary["outcomes"] = [];
  for (const id of ids) {
    try {
      outcomes.push((await sendDeliveryStep(id)).state);
    } catch {
      outcomes.push("error");
    }
  }
  await finishNotificationStep(notificationId);
  return { notificationId, outcomes };
}
