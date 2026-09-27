"use server";

import { performAction } from "../../../lib/actions/perform";
import { TICKETS_UPDATE } from "../../../lib/actions/tickets";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import { type MaintenanceActionResult, type TicketPatch } from "./action-result";

/**
 * Working a ticket (spec §5.6, §4.8, §8) — a one-line wrapper over
 * `tickets.update` (`src/lib/actions/tickets.ts`), the definition MCP's and
 * the chat's `update_ticket` share through `writeTicket`, so the surfaces
 * cannot disagree about what working a ticket means.
 *
 * It checks `maintenance.manage` for itself (a server action is reachable
 * without its page), writes no audit event (§4.11: an ordinary edit),
 * invalidates no cache (nothing cached reads a ticket) and tells the Notion
 * mirror. One action for status, priority, assignee and resolution: the patch
 * writes only the keys the control sent.
 */
export async function updateTicket(input: { logId: string; patch: TicketPatch }): Promise<MaintenanceActionResult> {
  return performAction(TICKETS_UPDATE, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}
