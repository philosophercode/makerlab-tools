"use server";

import { INSIGHTS_DISMISS_GAP, INSIGHTS_FILE_CORRECTION } from "../../../lib/actions/insights";
import { performAction } from "../../../lib/actions/perform";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import type { InsightsActionResult } from "./action-result";

/**
 * The Unanswered queue's decisions (usage insight spec §7): one-line wrappers
 * over `insights.dismiss_gap` and `insights.file_correction`
 * (`src/lib/actions/insights.ts`), each gated on `insights.view` by
 * `performAction`.
 */
export async function dismissUnanswered(input: { gapId: string }): Promise<InsightsActionResult> {
  return performAction(INSIGHTS_DISMISS_GAP, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}

export async function fileUnansweredAsCorrection(input: { gapId: string }): Promise<InsightsActionResult> {
  return performAction(INSIGHTS_FILE_CORRECTION, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}
