import { after } from "next/server";
import { requestNotificationDelivery } from "./trigger";

/**
 * Hand committed outbox rows to delivery **after the response is sent**
 * (email notifications spec §5.1 step 3: "the student's answer does not wait
 * for either"), the way `mirror/after-response.ts` does for the mirror.
 *
 * Outside a Next request (a test, a script) `after` is unavailable; delivery
 * then runs straight away and the returned promise is that work, so a caller
 * that awaits it keeps the process alive until it is done. Inside a request
 * it resolves at once. It never rejects.
 */
export function requestNotificationDeliveryAfterResponse(notificationIds: readonly (string | null | undefined)[]): Promise<void> {
  try {
    after(() => requestNotificationDelivery(notificationIds));
    return Promise.resolve();
  } catch {
    return requestNotificationDelivery(notificationIds).then(
      () => undefined,
      () => undefined
    );
  }
}
