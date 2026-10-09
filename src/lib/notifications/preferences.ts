import { eq, inArray, sql } from "drizzle-orm";
import { notificationPreferences } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import { NOTIFICATION_EVENT_DEFS, isNotificationDelivery, type NotificationDelivery, type NotificationEvent } from "./events.ts";

/**
 * A person's notification choices (email notifications spec §4.3). No row
 * means every default. v1 writes a row only through the one-click
 * unsubscribe; v1.1's `/account` section writes the rest.
 */

export interface StoredPreferences {
  emailEnabled: boolean;
  events: Partial<Record<NotificationEvent, NotificationDelivery>>;
  suppressedAt: Date | null;
}

/**
 * How this person takes `event`, given their stored row (or none). A switched
 * off master or a suppressed address is `off` for everything. A stored value
 * that is not a delivery falls back to the default rather than throwing.
 */
export function deliveryFor(prefs: StoredPreferences | null | undefined, event: NotificationEvent): NotificationDelivery {
  if (prefs && (!prefs.emailEnabled || prefs.suppressedAt)) return "off";
  const stored = prefs?.events?.[event];
  return isNotificationDelivery(stored) ? stored : NOTIFICATION_EVENT_DEFS[event].defaultDelivery;
}

/** The stored rows for these people, by user id. Someone with no row is absent. */
export async function loadPreferences(db: Db, userIds: readonly string[]): Promise<Map<string, StoredPreferences>> {
  const out = new Map<string, StoredPreferences>();
  if (userIds.length === 0) return out;
  const rows = await db
    .select({
      userId: notificationPreferences.userId,
      emailEnabled: notificationPreferences.emailEnabled,
      events: notificationPreferences.events,
      suppressedAt: notificationPreferences.suppressedAt,
    })
    .from(notificationPreferences)
    .where(inArray(notificationPreferences.userId, [...userIds]));
  for (const row of rows) {
    out.set(row.userId, { emailEnabled: row.emailEnabled, events: row.events ?? {}, suppressedAt: row.suppressedAt });
  }
  return out;
}

/**
 * Turn one event off for one person (the unsubscribe write). Upserts the row
 * and merges the one key into `events`, so other choices are kept. Answers
 * what the event was before, so the audit row can say `{ from, to }`.
 */
export async function setEventOff(db: Db, userId: string, event: NotificationEvent): Promise<{ from: NotificationDelivery }> {
  const [existing] = await db
    .select({
      emailEnabled: notificationPreferences.emailEnabled,
      events: notificationPreferences.events,
      suppressedAt: notificationPreferences.suppressedAt,
    })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);
  const from = deliveryFor(existing ?? null, event);
  const patch = JSON.stringify({ [event]: "off" });
  await db
    .insert(notificationPreferences)
    .values({ userId, events: { [event]: "off" } })
    .onConflictDoUpdate({
      target: notificationPreferences.userId,
      set: { events: sql`${notificationPreferences.events} || ${patch}::jsonb` },
    });
  return { from };
}
