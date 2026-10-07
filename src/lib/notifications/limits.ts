/**
 * Numbers the notification workflows share (email notifications spec §3.3,
 * amendment 2026-10-07). No imports: the workflow body imports this, and the
 * workflow bundle must not pull a database client into the sandbox.
 */

/** The daily reminder's hour on the lab's clock: 08:00. */
export const REMINDER_HOUR = 8;

/** How many times a send is attempted before a retryable failure becomes `failed` / `provider_error`. */
export const MAX_SEND_ATTEMPTS = 4;
