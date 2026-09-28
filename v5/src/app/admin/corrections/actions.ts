"use server";

import { CORRECTIONS_SET_STATUS } from "../../../lib/actions/corrections";
import { performAction } from "../../../lib/actions/perform";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import { type CorrectionActionResult } from "./action-result";

/**
 * Triaging a correction (spec §5.6, §4.9, §8) — a one-line wrapper over
 * `corrections.set_status` (`src/lib/actions/corrections.ts`).
 *
 * It checks `feedback.manage` for itself, which is not `tools.edit`; the
 * status is the whole write (the catalogue is changed in the tool editor the
 * queue links to); no audit event and no cache invalidation. Going backwards
 * is allowed: a dismissal is a judgement, and undoing it needs no console.
 */
export async function setCorrectionStatus(input: { feedbackId: string; status: string }): Promise<CorrectionActionResult> {
  return performAction(CORRECTIONS_SET_STATUS, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}
