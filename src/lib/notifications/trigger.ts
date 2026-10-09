import type { Db } from "../db/types.ts";
import { isUuid } from "../data/uuid.ts";
import { isEmailConfigured } from "./config.ts";
import { deliverInline } from "./deliver.ts";

/**
 * `requestNotificationDelivery(ids)`: "these outbox rows just committed"
 * (email notifications spec §3.2). Follows `requestMirrorPush()`.
 *
 * **It never throws, and a failure never touches the write that called it**
 * (G4, Article 4): the ticket has already committed. Every failure leaves one
 * fixed log line with an outbox id and nothing about the ticket or a person,
 * and the daily cron backstop picks the row up.
 *
 * Two paths:
 *
 * - **Email configured** (`RESEND_API_KEY` and `EMAIL_FROM`): load `start.ts`
 *   with a dynamic `import()` and start one `deliverNotification` run per
 *   row. `workflow/api` stays out of every caller's static graph.
 * - **Not configured** (local, CI, a preview without the integration): run
 *   the same fan-out and send code in this process. Each delivery is recorded
 *   `failed` / `not_configured` and nothing reaches any network (Article 3:
 *   everything runs offline), without starting a workflow at all.
 */
export async function requestNotificationDelivery(notificationIds: readonly (string | null | undefined)[], options: { db?: Db } = {}): Promise<void> {
  const ids = [...new Set(notificationIds.filter((id): id is string => typeof id === "string" && isUuid(id)))];
  if (ids.length === 0) return;

  if (!isEmailConfigured()) {
    for (const id of ids) {
      try {
        await deliverInline(id, { db: options.db });
      } catch {
        console.error(`[notifications] could not record delivery of ${id}; the daily backstop will retry`);
      }
    }
    return;
  }

  try {
    const { startNotificationDelivery } = await import("./start.ts");
    for (const id of ids) await startNotificationDelivery(id);
  } catch {
    console.error("[notifications] could not load the workflow runtime; the daily backstop will retry");
  }
}
