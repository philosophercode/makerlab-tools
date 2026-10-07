import { sql } from "drizzle-orm";
import { rawRows } from "../db/raw.ts";
import type { Db } from "../db/types.ts";
import type { NotificationEvent } from "./events.ts";

/**
 * The outbound cap on immediate staff alerts (email notifications spec §5.3,
 * G7). Anonymous chat can file tickets, so without it a script could use the
 * lab to flood staff inboxes and get the sending domain flagged.
 *
 * At most `cap` notifications of an event fan out per rolling hour, counted
 * from the outbox itself (rows that already fanned out), on the database's
 * clock. Past the cap a row is `skipped` / `capped`: the ticket still waits
 * in the queue on `/admin/maintenance`, it just is not emailed.
 */

/** True when `alreadySent` in the last hour leaves no room for one more. Pure. */
export function isOverCap(alreadySent: number, cap: number): boolean {
  return alreadySent >= cap;
}

/** How many `event` notifications fanned out in the hour before now, not counting `exceptId`. */
export async function countRecentFanOuts(db: Db, event: NotificationEvent, exceptId: string): Promise<number> {
  const [row] = await rawRows<{ n: number | string }>(
    db,
    sql`select count(*) as n
          from notifications
         where event = ${event}
           and status in ('fanned_out', 'done')
           and id <> ${exceptId}::uuid
           and created_at > now() - interval '1 hour'`
  );
  return Number(row?.n ?? 0);
}
