import { createMaintenanceLog, type CreatedMaintenanceLog, type NewMaintenanceLog } from "../data/maintenance";
import { requestNotificationDeliveryAfterResponse } from "../notifications/after-response";
import { invalidateMaintenance } from "../revalidate";

/**
 * Filing one problem report as a maintenance ticket: the one write behind the
 * assistant's `report_issue` and the quick report form (quick report spec
 * §3.2). Both hand it a validated ticket; it writes the row (and claims the
 * photos, and queues the `ticket.filed` email) through `createMaintenanceLog`,
 * then drops the caches that count tickets and hands the email to delivery.
 *
 * Always an open **issue report**, so staff see the same kind of ticket
 * whichever door it came through. Throws when the write fails: each caller
 * tells the student the report did not land (Article 4). A cache that cannot
 * be dropped is only logged, because the ticket is already safe.
 */
export type ProblemTicket = Omit<NewMaintenanceLog, "type" | "status">;

export async function fileProblemTicket(ticket: ProblemTicket): Promise<CreatedMaintenanceLog> {
  const record = await createMaintenanceLog({
    ...ticket,
    // Display casing, as `report_issue` has always sent it; the data module
    // maps it to the stored vocabulary (`issue_report`, `open`).
    type: "Issue Report",
    status: "Open",
  });

  // The kiosk's open-ticket count (kiosk spec §3.1) and the tool page's
  // maintenance history. A cache that cannot be dropped is a screen a poll
  // behind, never a lost ticket.
  try {
    invalidateMaintenance();
  } catch (err) {
    console.warn(`[maintenance] ticket ${record.id} filed; the ticket-count cache could not be cleared`, err);
  }

  // Email the staff who work tickets (email notifications spec §3.2), after
  // the answer is on its way. Never throws, and a failed send never un-files
  // the ticket: the outbox row committed with it, and the daily backstop
  // retries anything that did not start.
  await requestNotificationDeliveryAfterResponse([record.notificationId]);
  return record;
}
