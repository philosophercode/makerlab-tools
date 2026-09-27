"use server";

import { runQueueWrite } from "../../../lib/admin/queue-write";
import { updateFeedbackStatus } from "../../../lib/data/feedback";
import { CORRECTIONS_PATH, type CorrectionActionResult } from "./action-result";

/**
 * Triaging a correction (spec §5.6, §4.9, §8).
 *
 * **It checks `feedback.manage` for itself**, and that is not the same
 * permission as `/admin/inventory`'s: a server action is a POST endpoint with a
 * generated name, so a caller holding `tools.edit` and nothing else is refused
 * here even though they could fix the field the correction is about. The two
 * are separate declarations in `permissions.ts` precisely so that can be true.
 *
 * **The status is the whole write.** A correction is a message somebody sent,
 * not a record to edit; changing the catalogue happens in the tool editor,
 * which the queue links to. That separation is also what keeps §8's promise
 * that a student's report is inert — there is no path from the sentence to the
 * field, only from the sentence to a person.
 *
 * **No audit event** (§4.11: security-relevant actions only, and this is an
 * ordinary edit) and **no cache invalidation** — nothing cached reads the
 * `feedback` table.
 */

/** Names this surface in the console line a failure leaves behind. */
const SURFACE = "admin/corrections";

/**
 * Mark one correction `reviewed`, `fixed` or `dismissed` — or back to `new`.
 *
 * Going backwards is allowed on purpose: dismissing a correction is a
 * judgement, and the reviewer who made it in a hurry should be able to undo it
 * without a database console.
 */
export async function setCorrectionStatus(input: {
  feedbackId: string;
  status: string;
}): Promise<CorrectionActionResult> {
  return runQueueWrite({
    permission: "feedback.manage",
    path: CORRECTIONS_PATH,
    surface: SURFACE,
    write: (identity) =>
      updateFeedbackStatus(input.feedbackId, input.status, { actorUserId: identity.userId }),
  });
}
