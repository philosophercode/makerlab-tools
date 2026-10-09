import { RetryableError } from "workflow";
import { fanOutNotification, finishNotification, sendDelivery, type DeliveryOutcome } from "./deliver.ts";
import { MAX_SEND_ATTEMPTS } from "./limits.ts";
import { enqueueMaintenanceReminder, planReminder, type ReminderEnqueue, type ReminderPlan } from "./reminder.ts";

/**
 * The notification workflows' steps (email notifications spec §3.3). Each is
 * a thin `"use step"` over a plain function in `deliver.ts` or
 * `reminder.ts`, so the inline path and the tests call the same code.
 *
 * **Retries.** {@link sendDeliveryStep} throws a {@link RetryableError} when
 * the provider may answer next time (429, 409, 5xx, a timeout). The SDK
 * retries it `maxRetries` times with backoff; the attempt count lives on the
 * delivery row, so the last attempt records `failed` / `provider_error` and
 * returns instead of throwing. Anything else a step throws is the database
 * having a bad minute and is retried a minute later; its message is fixed
 * text, so no driver error (which can carry query values) reaches the run's
 * event log.
 *
 * `maxRetries` is set as a property on each step function, which is how the
 * Workflow SDK reads it. Steps run from a pre-built bundle under plain Node,
 * so nothing here or below imports `"server-only"` or `next/*`.
 */

const DB_RETRY_AFTER = "1m";

function dbError(stage: string): RetryableError {
  return new RetryableError(`Notification ${stage}: the database could not be used.`, { retryAfter: DB_RETRY_AFTER });
}

export async function fanOutStep(notificationId: string): Promise<string[]> {
  "use step";
  try {
    return await fanOutNotification(notificationId);
  } catch {
    throw dbError("fan-out");
  }
}
fanOutStep.maxRetries = 3;

export async function sendDeliveryStep(deliveryId: string): Promise<DeliveryOutcome> {
  "use step";
  let outcome: DeliveryOutcome;
  try {
    outcome = await sendDelivery(deliveryId);
  } catch {
    throw dbError("send");
  }
  if (outcome.state === "retry") {
    throw new RetryableError(`Delivery ${deliveryId}: the mail provider asked to retry (attempt ${outcome.attempts}).`);
  }
  return outcome;
}
sendDeliveryStep.maxRetries = MAX_SEND_ATTEMPTS - 1;

export async function finishNotificationStep(notificationId: string): Promise<void> {
  "use step";
  try {
    await finishNotification(notificationId);
  } catch {
    throw dbError("finish");
  }
}
finishNotificationStep.maxRetries = 3;

/** Today's lab date and the wait until 08:00, read here so the workflow body never reads the clock. */
export async function planReminderStep(hour: number): Promise<ReminderPlan> {
  "use step";
  return planReminder(new Date(), hour);
}

export async function enqueueReminderStep(labDate: string): Promise<ReminderEnqueue> {
  "use step";
  try {
    return await enqueueMaintenanceReminder(labDate);
  } catch {
    throw dbError("reminder");
  }
}
enqueueReminderStep.maxRetries = 3;
