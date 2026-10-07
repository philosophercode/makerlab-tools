import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { notificationDeliveries, notifications, user } from "../db/schema/index.ts";
import type { DeliveryReason, NotificationSkipReason, NotificationSurface } from "../db/schema/vocabulary.ts";
import type { Db } from "../db/types.ts";
import { labDateLabel, labTimeOfDay } from "../lab-time.ts";
import { siteUrl } from "../share/site-url.ts";
import { countRecentFanOuts, isOverCap } from "./caps.ts";
import { sendEmail, type SendResult } from "./channels/email.ts";
import { emailConfig, previewAllowList, ticketHourlyCap } from "./config.ts";
import { isNotificationEvent, type NotificationEvent } from "./events.ts";
import { MAX_SEND_ATTEMPTS } from "./limits.ts";
import { checkRecipient, resolveRecipients } from "./recipients.ts";
import { dueSubjectIsEmpty, loadDueSubject, loadTicketSubject, ticketStillOpen } from "./subjects.ts";
import { renderMaintenanceDue } from "./templates/maintenance-due.ts";
import { renderTicketFiled } from "./templates/ticket-filed.ts";
import type { RenderedEmail } from "./templates/html.ts";
import { signUnsubscribeToken, unsubscribeSecret } from "./unsubscribe.ts";

/**
 * Delivering one notification (email notifications spec §3.3): the work the
 * workflow's steps do, as plain functions. `steps.ts` wraps each in a
 * `"use step"`; `trigger.ts` calls them directly when email is not
 * configured, so a ticket filed offline still records its deliveries as
 * `not_configured` without loading the workflow runtime.
 *
 * **The database, not the run, is the source of truth.** Fan-out inserts one
 * delivery per recipient with `ON CONFLICT DO NOTHING`; a send first claims
 * its row with a conditional update; the delivery id is the provider's
 * `Idempotency-Key`. So a replayed step, a duplicate run or the cron backstop
 * all converge on one email per person.
 *
 * **The address is read in {@link sendDelivery} only**, handed to the channel
 * and dropped. Log lines carry delivery and notification ids, never an
 * address, a name or ticket text.
 *
 * Relative imports with `.ts` and no `"server-only"`: steps run under plain
 * Node.
 */

export { MAX_SEND_ATTEMPTS };

export interface DeliverOptions {
  db?: Db;
  fetchImpl?: typeof fetch;
}

async function handle(options: DeliverOptions): Promise<Db> {
  return options.db ?? (await getDb());
}

interface OutboxRow {
  id: string;
  event: NotificationEvent;
  subjectType: string | null;
  subjectId: string | null;
  surface: NotificationSurface | null;
  status: string;
}

async function loadOutboxRow(db: Db, notificationId: string): Promise<OutboxRow | null> {
  const [row] = await db
    .select({
      id: notifications.id,
      event: notifications.event,
      subjectType: notifications.subjectType,
      subjectId: notifications.subjectId,
      surface: notifications.surface,
      status: notifications.status,
    })
    .from(notifications)
    .where(eq(notifications.id, notificationId))
    .limit(1);
  if (!row || !isNotificationEvent(row.event)) return null;
  return { ...row, surface: (row.surface as NotificationSurface | null) ?? null };
}

async function skipNotification(db: Db, id: string, reason: NotificationSkipReason): Promise<void> {
  await db
    .update(notifications)
    .set({ status: "skipped", skipReason: reason })
    .where(and(eq(notifications.id, id), eq(notifications.status, "queued")));
}

/** True when the subject is still worth an email: the ticket still open, the reminder still has tasks. */
async function subjectStillCurrent(db: Db, row: OutboxRow): Promise<boolean> {
  if (!row.subjectId) return false;
  if (row.event === "ticket.filed") return ticketStillOpen(await loadTicketSubject(db, row.subjectId));
  return !dueSubjectIsEmpty(await loadDueSubject(db, row.id, row.subjectId));
}

/**
 * Step 1 (§3.3): write one delivery row per recipient and mark the outbox
 * row `fanned_out`. Returns the deliveries still to send. A row that already
 * fanned out (or finished) returns its unsent deliveries, which is how the
 * cron backstop retries a send whose step gave up; a skipped row returns
 * none. A duplicate run reaching a delivery another run holds is harmless:
 * the provider answers a repeated idempotency key with the first result.
 */
export async function fanOutNotification(notificationId: string, options: DeliverOptions = {}): Promise<string[]> {
  const db = await handle(options);
  const row = await loadOutboxRow(db, notificationId);
  if (!row) return [];

  if (row.status === "queued") {
    if (!(await subjectStillCurrent(db, row))) {
      await skipNotification(db, row.id, "subject_gone");
      return [];
    }
    if (row.event === "ticket.filed") {
      const cap = ticketHourlyCap();
      if (isOverCap(await countRecentFanOuts(db, row.event, row.id), cap)) {
        await skipNotification(db, row.id, "capped");
        console.warn(`[notifications] ${row.id} not emailed: over the hourly cap of ${cap} ticket alerts`);
        return [];
      }
    }
    const recipients = await resolveRecipients(db, row.event);
    await db.transaction(async (tx) => {
      if (recipients.length > 0) {
        await tx
          .insert(notificationDeliveries)
          .values(recipients.map((userId) => ({ notificationId: row.id, userId })))
          .onConflictDoNothing({ target: [notificationDeliveries.notificationId, notificationDeliveries.userId] });
      }
      await tx
        .update(notifications)
        .set({ status: "fanned_out" })
        .where(and(eq(notifications.id, row.id), eq(notifications.status, "queued")));
    });
  } else if (row.status === "skipped") {
    return [];
  }

  const pending = await db
    .select({ id: notificationDeliveries.id })
    .from(notificationDeliveries)
    .where(and(eq(notificationDeliveries.notificationId, row.id), inArray(notificationDeliveries.status, ["pending", "sending"])))
    .orderBy(asc(notificationDeliveries.createdAt), asc(notificationDeliveries.id));
  return pending.map((delivery) => delivery.id);
}

/** What one send came to. `retry` means the provider may answer next time: the step throws and is retried. */
export type DeliveryOutcome =
  | { state: "sent" }
  | { state: "skipped"; reason: DeliveryReason }
  | { state: "failed"; reason: DeliveryReason }
  | { state: "retry"; attempts: number }
  | { state: "not_claimed" };

async function settle(db: Db, id: string, status: "skipped" | "failed", reason: DeliveryReason): Promise<DeliveryOutcome> {
  await db.update(notificationDeliveries).set({ status, reason }).where(eq(notificationDeliveries.id, id));
  return { state: status, reason };
}

/**
 * Step 2 (§3.3), for one recipient: claim, re-check, render, send, record.
 * Never throws for a provider answer; the caller turns `retry` into a retry.
 */
export async function sendDelivery(deliveryId: string, options: DeliverOptions = {}): Promise<DeliveryOutcome> {
  const db = await handle(options);

  // Claim. `sending` is re-claimable: a crash between the provider's 200 and
  // our `sent` write leaves it there, and the idempotency key makes the
  // second request a no-op at the provider.
  const [claimed] = await db
    .update(notificationDeliveries)
    .set({ status: "sending", attempts: sql`${notificationDeliveries.attempts} + 1` })
    .where(and(eq(notificationDeliveries.id, deliveryId), inArray(notificationDeliveries.status, ["pending", "sending"])))
    .returning({
      notificationId: notificationDeliveries.notificationId,
      userId: notificationDeliveries.userId,
      attempts: notificationDeliveries.attempts,
    });
  if (!claimed) return { state: "not_claimed" };

  const row = await loadOutboxRow(db, claimed.notificationId);
  if (!row || !row.subjectId) return settle(db, deliveryId, "skipped", "subject_gone");

  const recipient = await checkRecipient(db, claimed.userId, row.event);
  if (!recipient.ok) return settle(db, deliveryId, "skipped", recipient.reason ?? "no_permission");

  const config = emailConfig();
  const secret = unsubscribeSecret();
  if (!config || !secret) return settle(db, deliveryId, "failed", "not_configured");

  const origin = siteUrl().origin;
  const unsubscribeToken = signUnsubscribeToken({ userId: claimed.userId, event: row.event, issuedAt: Math.floor(Date.now() / 1000) }, secret);
  const unsubscribePage = unsubscribeToken ? `${origin}/notifications/unsubscribe?t=${encodeURIComponent(unsubscribeToken)}` : null;
  const oneClick = unsubscribeToken ? `${origin}/api/notifications/unsubscribe?t=${encodeURIComponent(unsubscribeToken)}` : null;

  const rendered = await render(db, row, origin, unsubscribePage);
  if (!rendered) return settle(db, deliveryId, "skipped", "subject_gone");

  // The address, read here and nowhere else, and never stored or logged.
  const [person] = await db.select({ email: user.email }).from(user).where(eq(user.id, claimed.userId)).limit(1);
  if (!person?.email) return settle(db, deliveryId, "skipped", "no_permission");
  const allowed = previewAllowList();
  if (allowed && !allowed.has(person.email.trim().toLowerCase())) return settle(db, deliveryId, "skipped", "preview_blocked");

  const headers: Record<string, string> = {};
  if (oneClick) {
    headers["List-Unsubscribe"] = `<${oneClick}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  const result: SendResult = await sendEmail(
    config,
    { to: person.email, subject: rendered.subject, text: rendered.text, html: rendered.html, headers, idempotencyKey: deliveryId },
    options.fetchImpl
  );

  if (result.ok) {
    await db
      .update(notificationDeliveries)
      .set({ status: "sent", reason: null, providerMessageId: result.providerMessageId, sentAt: new Date() })
      .where(eq(notificationDeliveries.id, deliveryId));
    return { state: "sent" };
  }
  if (!result.retryable) {
    console.warn(`[notifications] delivery ${deliveryId} failed: ${result.code} (HTTP ${result.status})`);
    return settle(db, deliveryId, "failed", result.code);
  }
  if (claimed.attempts >= MAX_SEND_ATTEMPTS) {
    console.warn(`[notifications] delivery ${deliveryId} failed after ${claimed.attempts} attempts (HTTP ${result.status ?? "none"})`);
    return settle(db, deliveryId, "failed", "provider_error");
  }
  return { state: "retry", attempts: claimed.attempts };
}

/** The email for one recipient, from the subject's current state, or null when it is gone. */
async function render(db: Db, row: OutboxRow, origin: string, unsubscribeUrl: string | null): Promise<RenderedEmail | null> {
  if (!row.subjectId) return null;
  if (row.event === "ticket.filed") {
    const ticket = await loadTicketSubject(db, row.subjectId);
    if (!ticketStillOpen(ticket)) return null;
    return renderTicketFiled({
      ticket,
      surface: row.surface,
      origin,
      ticketUrl: `${origin}/admin/maintenance#ticket-${ticket.id}`,
      unsubscribeUrl,
      filedAt: labTimeOfDay(ticket.createdAt),
    });
  }
  const due = await loadDueSubject(db, row.id, row.subjectId);
  if (dueSubjectIsEmpty(due)) return null;
  return renderMaintenanceDue({
    due,
    origin,
    checklistUrl: `${origin}/admin/maintenance#due-tasks`,
    unsubscribeUrl,
    dateLabel: labDateLabel(due.labDate),
  });
}

/** Step 3 (§3.3): the run reached the end. One log line with counts and the notification id. */
export async function finishNotification(notificationId: string, options: DeliverOptions = {}): Promise<void> {
  const db = await handle(options);
  await db
    .update(notifications)
    .set({ status: "done" })
    .where(and(eq(notifications.id, notificationId), eq(notifications.status, "fanned_out")));
  const counts = await db
    .select({ status: notificationDeliveries.status, n: sql<number>`count(*)::int` })
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.notificationId, notificationId))
    .groupBy(notificationDeliveries.status);
  if (counts.length > 0) {
    const summary = counts.map((c) => `${c.status}=${c.n}`).join(" ");
    console.info(`[notifications] ${notificationId}: ${summary}`);
  }
}

/**
 * The whole delivery in one process, for when no workflow is started (email
 * not configured): fan out, try each recipient once, finish. A `retry`
 * outcome cannot happen here (the channel is never called without a
 * configuration), and any that did is left for the cron backstop.
 */
export async function deliverInline(notificationId: string, options: DeliverOptions = {}): Promise<void> {
  const ids = await fanOutNotification(notificationId, options);
  for (const id of ids) await sendDelivery(id, options);
  await finishNotification(notificationId, options);
}
