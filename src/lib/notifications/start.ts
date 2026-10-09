import { start } from "workflow/api";
import { deliverNotification, maintenanceReminder } from "../../workflows/notifications.ts";

/**
 * Starting the notification workflows: the one module that imports
 * `workflow/api` for notifications (email notifications spec §3.1). Callers
 * reach it through `trigger.ts`'s dynamic `import()`, taken only when email
 * is configured, so a ticket filed offline never loads the workflow runtime.
 *
 * Starting is not sending. Each function answers whether the run was
 * started; what it did is on the delivery rows. A failure leaves one log line
 * with the error's name only, never an address or ticket text.
 */

export async function startNotificationDelivery(notificationId: string): Promise<boolean> {
  try {
    await start(deliverNotification, [notificationId]);
    return true;
  } catch (error) {
    console.error(`[notifications] could not start delivery of ${notificationId}: ${errorName(error)}`);
    return false;
  }
}

export async function startMaintenanceReminder(): Promise<boolean> {
  try {
    await start(maintenanceReminder, []);
    return true;
  } catch (error) {
    console.error(`[notifications] could not start the maintenance reminder: ${errorName(error)}`);
    return false;
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown error";
}
