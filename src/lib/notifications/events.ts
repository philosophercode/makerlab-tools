import type { Permission } from "../auth/permissions.ts";
import {
  NOTIFICATION_DELIVERIES,
  NOTIFICATION_EVENTS,
  isOneOf,
  type NotificationDelivery,
  type NotificationEvent,
} from "../db/schema/vocabulary.ts";

/**
 * What the app emails about, and to whom (email notifications spec §3.4,
 * §4.4). One entry per event. Recipients are everyone whose role can() the
 * event's permission, resolved at send time, never a list of role names.
 *
 * - `ticket.filed` (v1): a ticket filed from the chat, the report form (the
 *   Report button and a unit's QR label open the chat with the report
 *   started) or an MCP client.
 * - `maintenance.due` (amendment 2026-10-07): the daily reminder of
 *   recurring tasks due today and overdue, at 08:00 lab time.
 *
 * Defaults are per event, not per role: moving a permission between roles in
 * `permissions.ts` moves the recipients, with no migration.
 */

export { NOTIFICATION_EVENTS, NOTIFICATION_DELIVERIES };
export type { NotificationEvent, NotificationDelivery };

export interface NotificationEventDef {
  event: NotificationEvent;
  /** Who may receive it. */
  permission: Permission;
  defaultDelivery: NotificationDelivery;
  /** What the unsubscribe page says will stop, in a few words. */
  stops: "ticketFiled" | "maintenanceDue";
}

export const NOTIFICATION_EVENT_DEFS: Readonly<Record<NotificationEvent, NotificationEventDef>> = {
  "ticket.filed": {
    event: "ticket.filed",
    permission: "maintenance.manage",
    defaultDelivery: "immediate",
    stops: "ticketFiled",
  },
  "maintenance.due": {
    event: "maintenance.due",
    permission: "maintenance.manage",
    defaultDelivery: "immediate",
    stops: "maintenanceDue",
  },
};

export function isNotificationEvent(value: unknown): value is NotificationEvent {
  return typeof value === "string" && isOneOf(NOTIFICATION_EVENTS, value);
}

export function isNotificationDelivery(value: unknown): value is NotificationDelivery {
  return typeof value === "string" && isOneOf(NOTIFICATION_DELIVERIES, value);
}

/** The outbox's unique key for an event about one subject: a second enqueue of it inserts nothing. */
export function dedupeKeyFor(event: NotificationEvent, subjectId: string): string {
  return `${event}:${subjectId}`;
}
