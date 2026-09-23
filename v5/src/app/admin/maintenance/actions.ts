"use server";

import { runQueueWrite } from "../../../lib/admin/queue-write";
import { updateMaintenanceLog } from "../../../lib/data/maintenance";
import { requestMirrorPush } from "../../../lib/mirror/trigger";
import {
  MAINTENANCE_PATH,
  type MaintenanceActionResult,
  type TicketPatch,
} from "./action-result";

/**
 * Working a ticket (spec §5.6, §4.8, §8).
 *
 * **It checks `maintenance.manage` for itself.** A server action is a POST
 * endpoint with a generated name, reachable without the page that offers the
 * control, so the page's own gate is evidence of nothing — and this is the
 * permission this surface needs, not `tools.edit`, which a SuperMaker might
 * hold without ever having been given the tickets.
 *
 * **No audit event, deliberately.** §4.11 scopes the trail to security-relevant
 * actions and says ordinary edits are not logged; moving a ticket to "in
 * progress" is the most ordinary edit in the lab. `maintenance_logs` carries
 * `updated_by` and `updated_at`, which is the record this change earns.
 *
 * **And no cache invalidation.** Nothing cached reads a ticket: the catalogue
 * shows unit *status*, which is the tool editor's field and a different write.
 * Busting the catalogue here would cost a full re-read every time somebody
 * ticked a box.
 *
 * **But it does tell the Notion mirror.** The mirror carries every maintenance
 * log (§3.8), so a ticket's status, priority, assignee or resolution is a
 * change it should hold. `requestMirrorPush()` runs after the write commits,
 * never throws, and coalesces: a reviewer clearing ten tickets starts one
 * push two minutes later, not ten. A refused write never reaches it.
 */

/** Names this surface in the console line a failure leaves behind. */
const SURFACE = "admin/maintenance";

/**
 * Change one ticket's status, priority, assignee or resolution.
 *
 * One action rather than four, because the controls are four views of one row
 * and the page saves each of them the moment it changes — a queue somebody has
 * ten minutes for cannot afford a Save button per field. The patch shape is
 * what keeps that safe: an unsent key is not written.
 */
export async function updateTicket(input: {
  logId: string;
  patch: TicketPatch;
}): Promise<MaintenanceActionResult> {
  return runQueueWrite({
    permission: "maintenance.manage",
    path: MAINTENANCE_PATH,
    surface: SURFACE,
    write: (identity) =>
      updateMaintenanceLog(input.logId, input.patch, { actorUserId: identity.userId }),
    afterCommit: async () => {
      await requestMirrorPush();
      return undefined;
    },
  });
}
