import "server-only";

import { performAction } from "../actions/perform";
import { TICKETS_UPDATE } from "../actions/tickets";
import type { ActionSurface } from "../actions/define";
import { resolveIdentityFromHeaders, type Identity } from "../auth/identity";
import type { MaintenanceLogPatch } from "../data/maintenance";
import type { QueueActionResult } from "./queue-write";

/**
 * Working one maintenance ticket from outside the admin page — MCP's and the
 * chat's `update_ticket` (MCP access spec §3.2). A wrapper over the same
 * `tickets.update` definition `/admin/maintenance` runs
 * (`src/lib/actions/tickets.ts`, assistant–GUI parity spec phase 1), so the
 * gate, the write and the mirror push cannot drift between them.
 */

/** The page the change refreshes. */
export const MAINTENANCE_PATH = "/admin/maintenance";

export type TicketWriteError = "not_found" | "invalid_field";

export async function writeTicket(
  input: { logId: string; patch: MaintenanceLogPatch },
  options: { identity?: Identity; surface?: ActionSurface } = {}
): Promise<QueueActionResult<TicketWriteError>> {
  const identity = options.identity ?? (await resolveIdentityFromHeaders());
  return performAction(TICKETS_UPDATE, input, identity, { surface: options.surface ?? "gui" });
}
