import { sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { rawRows } from "../db/raw.ts";
import type { Db } from "../db/types.ts";
import { labToday } from "../lab-time.ts";
import { isEmailConfigured } from "../notifications/config.ts";
import { deliverInline } from "../notifications/deliver.ts";
import { enqueueMaintenanceReminder } from "../notifications/reminder.ts";

/**
 * The daily cron's notification stage (email notifications spec §3.6; the
 * reminder is amendment 2026-10-07, revised by "The reminder follows each
 * task's cadence"). Runs after the mirror and manual stages,
 * before the heartbeat.
 *
 * 1. **Stuck sends.** A delivery still `pending` or `sending` 20 hours after
 *    it was written is `failed` / `stuck` and never sent: the provider keeps
 *    an idempotency key for 24 hours, so past that a retry could send twice.
 * 2. **Backstop.** An outbox row still `queued` 15 minutes after it was
 *    written (its run never started), or one with sends left `pending` or
 *    `sending` for more than an hour, gets its delivery started again.
 *    **Once**: `restarted_at` is set by the same statement that picks it, so
 *    a second night never restarts it.
 * 3. **Retention.** Outbox rows older than 180 days are deleted, and their
 *    deliveries with them. A reminder's record of a task's due date is
 *    deleted once that cycle is over (the task was checked off and its due
 *    date moved on), since nothing can name that date again.
 * 4. **The maintenance reminder.** Starts `maintenanceReminder`, which sleeps
 *    until 08:00 lab time and emails staff the recurring tasks that came due
 *    since the last reminder, each once per due date (none newly due,
 *    nothing sent).
 *
 * With email not configured, steps 2 and 4 run in this process and record
 * `not_configured` deliveries, with no workflow and no network. With it
 * configured, they only start runs. A start that failed counts in `failed`,
 * and the route treats that as a failed stage, as it does for the mirror.
 */

export const STUCK_AFTER_HOURS = 20;
export const RESTART_AFTER_MINUTES = 15;
export const RETRY_AFTER_MINUTES = 60;
export const RETENTION_DAYS = 180;

export interface NotificationStageOptions {
  db?: Db;
  /** The lab's today, for the reminder; tests pass one. */
  today?: string;
}

export interface NotificationStageResult {
  /** Deliveries given up as `stuck`. */
  stuck: number;
  /** Outbox rows whose delivery was started again. */
  restarted: number;
  /** Outbox rows deleted for age. */
  deleted: number;
  /** Reminder records deleted because their task's cycle is over. */
  pruned: number;
  /** `started` (a run), `recorded` (inline, email not configured), `nothing_due`, `already_queued` or `failed`. */
  reminder: "started" | "recorded" | "nothing_due" | "already_queued" | "failed";
  /** Starts that failed, the reminder's included. */
  failed: number;
}

export async function runNotificationStage(options: NotificationStageOptions = {}): Promise<NotificationStageResult> {
  const db = options.db ?? (await getDb());
  const configured = isEmailConfigured();

  const stuckRows = await rawRows<{ id: string }>(
    db,
    sql`update notification_deliveries
           set status = 'failed', reason = 'stuck'
         where status in ('pending', 'sending')
           and created_at < now() - make_interval(hours => ${STUCK_AFTER_HOURS})
     returning id`
  );

  const restartRows = await rawRows<{ id: string }>(
    db,
    sql`update notifications n
           set restarted_at = now()
         where n.restarted_at is null
           and (
             (n.status = 'queued' and n.created_at < now() - make_interval(mins => ${RESTART_AFTER_MINUTES}))
             or exists (
               select 1 from notification_deliveries d
                where d.notification_id = n.id
                  and d.status in ('pending', 'sending')
                  and d.created_at < now() - make_interval(mins => ${RETRY_AFTER_MINUTES})
             )
           )
     returning n.id`
  );

  let failed = 0;
  let restarted = 0;
  const start = configured ? await import("../notifications/start.ts") : null;
  for (const { id } of restartRows) {
    if (start) {
      if (await start.startNotificationDelivery(id)) restarted += 1;
      else failed += 1;
    } else {
      try {
        await deliverInline(id, { db });
        restarted += 1;
      } catch {
        failed += 1;
        console.error(`[cron] notifications: could not record delivery of ${id}`);
      }
    }
  }

  const deletedRows = await rawRows<{ id: string }>(
    db,
    sql`delete from notifications where created_at < now() - make_interval(days => ${RETENTION_DAYS}) returning id`
  );

  const prunedRows = await rawRows<{ schedule_id: string }>(
    db,
    sql`delete from maintenance_reminder_items i
         using maintenance_schedules s
         where s.id = i.schedule_id
           and i.due_on < s.next_due_on
     returning i.schedule_id`
  );

  let reminder: NotificationStageResult["reminder"];
  if (start) {
    if (await start.startMaintenanceReminder()) reminder = "started";
    else {
      reminder = "failed";
      failed += 1;
    }
  } else {
    const queued = await enqueueMaintenanceReminder(options.today ?? labToday(), { db });
    if (queued.queued) {
      await deliverInline(queued.id, { db });
      reminder = "recorded";
    } else {
      reminder = queued.reason;
    }
  }

  const result = { stuck: stuckRows.length, restarted, deleted: deletedRows.length, pruned: prunedRows.length, reminder, failed };
  if (result.stuck > 0 || restartRows.length > 0 || result.deleted > 0 || result.pruned > 0 || failed > 0) {
    console.info(
      `[cron] notifications: stuck=${result.stuck} restarted=${restarted} deleted=${result.deleted} pruned=${result.pruned} reminder=${reminder} failed=${failed}`
    );
  }
  return result;
}
