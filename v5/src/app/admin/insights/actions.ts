"use server";

import { INSIGHTS_DISMISS_GAP, INSIGHTS_FILE_CORRECTION, INSIGHTS_SET_VALUE_ASSUMPTIONS } from "../../../lib/actions/insights";
import { performAction } from "../../../lib/actions/perform";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import type { ValueAssumptions } from "../../../lib/usage/value/assumptions";
import type { InsightsActionResult, ValueAssumptionsResult } from "./action-result";

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

/**
 * The value report's assumptions (usage insight spec amendment "Value
 * report"): `insights.set_value_assumptions`, gated on `insights.configure`.
 */
export async function saveValueAssumptions(input: ValueAssumptions): Promise<ValueAssumptionsResult> {
  return performAction(INSIGHTS_SET_VALUE_ASSUMPTIONS, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}
