import type { AdminGateError } from "../../../lib/admin/action-result";
import type { QueueActionResult } from "../../../lib/admin/queue-write";

/**
 * What `/admin/maintenance`'s server action answers, and where it lives.
 *
 * Its own module with no directive, for the reason every admin surface has
 * one: a `"use server"` module may export **only async functions**, because
 * every export becomes a callable endpoint — a path constant and a result type
 * cannot live there. And `TicketControls` is a client island that has to render
 * these codes without pulling `next/headers` and the limiter into its graph.
 */

/** The page this action belongs to, and the path it refreshes. */
export const MAINTENANCE_PATH = "/admin/maintenance";

/**
 * Why a ticket did not change. Every code has an `admin.errors.<code>` message.
 *
 * {@link AdminGateError} is the shared half — not signed in, not permitted,
 * over the ceiling, or "it did not land". The two below are this surface's own,
 * passed through from `updateMaintenanceLog` rather than re-spelled, so a code
 * cannot drift between the two modules:
 *
 * - `not_found` — the ticket is gone, or never existed.
 * - `invalid_field` — a status or priority outside its vocabulary. Refused
 *   before Postgres sees it, whose CHECK constraint would reject the whole
 *   statement with a message no page can render.
 */
export type MaintenanceWriteError = "not_found" | "invalid_field";

export type MaintenanceActionError = AdminGateError | MaintenanceWriteError;

/**
 * Built from {@link MaintenanceWriteError} rather than from the codes again:
 * spelling them twice is how the union the page renders and the union the
 * action answers drift apart, and nothing would fail until a reviewer saw a
 * blank line where a refusal should be.
 */
export type MaintenanceActionResult = QueueActionResult<MaintenanceWriteError>;

/**
 * What the controls may change about a ticket (spec §5.6).
 *
 * A patch, not a record: only the keys the control sent are written, so
 * assigning a ticket cannot blank the resolution somebody typed a moment
 * earlier from another screen.
 */
export interface TicketPatch {
  /** One of `MAINTENANCE_STATUS`. */
  status?: string;
  /** One of `MAINTENANCE_PRIORITY`, or null to clear it. */
  priority?: string | null;
  /** `user.id`, or null to unassign. */
  assignedToUserId?: string | null;
  /** The assignee's name, stored beside the id as the snapshot §4.8 wants. */
  assignedToName?: string | null;
  resolution?: string | null;
}

/** The shape `MaintenanceQueue` hands its island, and the page hands the queue. */
export type UpdateTicketAction = (input: {
  logId: string;
  patch: TicketPatch;
}) => Promise<MaintenanceActionResult>;
