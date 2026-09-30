import type { AdminGateError } from "../../../lib/admin/action-result";
import type { QueueActionResult } from "../../../lib/admin/queue-write";

/**
 * What `/admin/corrections`' server action answers, and where it lives.
 *
 * Directive-free for the reason every admin surface's result module is: a
 * `"use server"` module may export only async functions, and the client island
 * has to render these codes without importing the endpoint to get at its shape.
 */

/** The page this action belongs to, and the path it refreshes. */
export const CORRECTIONS_PATH = "/admin/corrections";

/**
 * Why a correction did not change. Each has an `admin.errors.<code>` message.
 *
 * - `not_found` — the correction is gone, or never existed.
 * - `invalid_field` — a status outside `FEEDBACK_STATUS`, refused before
 *   Postgres rejects the whole statement with a message no page can render.
 */
export type CorrectionWriteError = "not_found" | "invalid_field";

export type CorrectionActionError = AdminGateError | CorrectionWriteError;

/** One declaration of the codes, two shapes built from it — see `/admin/maintenance`. */
export type CorrectionActionResult = QueueActionResult<CorrectionWriteError>;

/** The shape `CorrectionsQueue` hands its island, and the page hands the queue. */
export type SetCorrectionStatusAction = (input: {
  feedbackId: string;
  status: string;
}) => Promise<CorrectionActionResult>;
