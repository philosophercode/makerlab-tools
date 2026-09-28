import "server-only";

import type { Identity } from "../auth/identity";
import { updateMaintenanceLog, type MaintenanceLogPatch } from "../data/maintenance";
import { requestMirrorPush } from "../mirror/trigger";
import { invalidateMaintenance } from "../revalidate";
import { runQueueWrite, type QueueActionResult } from "./queue-write";

/**
 * Working one maintenance ticket — the one write `/admin/maintenance`'s server
 * action and MCP's `update_ticket` share (MCP access spec §3.2: "the same
 * `runQueueWrite` path the admin page uses").
 *
 * Gate (`maintenance.manage`, the admin action ceiling), write, then tell the
 * Notion mirror, which carries every log. No audit event and no catalogue
 * invalidation, for the reasons `app/admin/maintenance/actions.ts` gives; the
 * one cache a ticket write clears is the kiosk's ticket count
 * (`invalidateMaintenance`, kiosk spec §3.1).
 */

/** The page the change refreshes. */
export const MAINTENANCE_PATH = "/admin/maintenance";

export type TicketWriteError = "not_found" | "invalid_field";

export async function writeTicket(
  input: { logId: string; patch: MaintenanceLogPatch },
  options: { identity?: Identity; surface?: string } = {}
): Promise<QueueActionResult<TicketWriteError>> {
  return runQueueWrite<TicketWriteError>({
    permission: "maintenance.manage",
    path: MAINTENANCE_PATH,
    surface: options.surface ?? "admin/maintenance",
    identity: options.identity,
    write: (identity) => updateMaintenanceLog(input.logId, input.patch, { actorUserId: identity.userId }),
    afterCommit: async () => {
      invalidateMaintenance();
      await requestMirrorPush();
      return undefined;
    },
  });
}
