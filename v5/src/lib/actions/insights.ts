import "server-only";

import { z } from "zod";
import { CORRECTIONS_PATH } from "../../app/admin/corrections/action-result";
import { INSIGHTS_PATH, VALUE_REPORT_PATH, type InsightsWriteError, type ValueAssumptionsError } from "../../app/admin/insights/action-result";
import { setLabSetting, VALUE_REPORT_SETTING } from "../data/lab-settings";
import { dismissGap, fileGapCorrection } from "../data/usage-gaps";
import { normalizeAssumptions, valueAssumptionsSchema, type ValueAssumptions } from "../usage/value/assumptions";
import { defineAction } from "./define";

/**
 * The Unanswered queue's two decisions (usage insight spec §7): dismiss a
 * question, or file it as a correction that lands on `/admin/corrections`.
 * Gated on `insights.view` — the permission that shows the queue — through
 * `performAction`, like every GUI write.
 *
 * **GUI only for now** (`assistant: "never"`, so never MCP either): the queue
 * holds student-written text, and phase 4 of the usage insight spec decides
 * how the assistant reads it (fenced, tainting the turn) before it may propose
 * acting on it. A "never" here carries no tool and no preview.
 *
 * Neither is audited, as no queue status change is (§4.11): the gap row
 * records `decided_by` / `decided_at` itself.
 */

const gapInput = z.object({ gapId: z.string() });

const NEVER_REASON =
  "The queue is student-written text; the usage insight spec's phase 4 decides how the assistant reads it (fenced, tainting the turn) before it may propose acting on it — /admin/insights is the surface until then";

export const INSIGHTS_DISMISS_GAP = defineAction<{ gapId: string }, object, InsightsWriteError>({
  id: "insights.dismiss_gap",
  toolName: "dismiss_unanswered_question",
  description: "Dismiss one unanswered question from the Insights queue. It reopens if it is asked three more times.",
  permission: "insights.view",
  risk: "operational",
  assistant: "never",
  neverReason: NEVER_REASON,
  input: gapInput,
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "usage_gap", id: input.gapId }),
  run: async (input, ctx) => {
    const outcome = await dismissGap(input.gapId, ctx.identity.userId);
    if (!outcome.ok) return { ok: false, error: outcome.reason };
    return { ok: true, value: {}, ...(outcome.changed ? { committed: true } : {}) };
  },
  revalidate: [INSIGHTS_PATH],
});

export const INSIGHTS_FILE_CORRECTION = defineAction<{ gapId: string }, object, InsightsWriteError>({
  id: "insights.file_correction",
  toolName: "file_unanswered_as_correction",
  description: "File one unanswered question as a correction for the tool it was about; it appears on the Corrections queue.",
  permission: "insights.view",
  risk: "operational",
  assistant: "never",
  neverReason: NEVER_REASON,
  input: gapInput,
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "usage_gap", id: input.gapId }),
  run: async (input, ctx) => {
    const outcome = await fileGapCorrection(input.gapId, ctx.identity.userId);
    if (!outcome.ok) return { ok: false, error: outcome.reason };
    return { ok: true, value: {}, ...(outcome.changed ? { committed: true } : {}) };
  },
  revalidate: [INSIGHTS_PATH, CORRECTIONS_PATH],
});

/**
 * The value report's assumptions (usage insight spec amendment "Value
 * report"): minutes per question, hourly cost, staffed hours, term windows,
 * which unanswered kinds do not count as handled, and MCP. One JSON setting per
 * deployment (`lab_settings.value_report`), validated in full on every save.
 * Gated on **`insights.configure`** — admins and super admins today, its own
 * grant so "directors only" is one line in `permissions.ts`.
 *
 * GUI only (`assistant: "never"`): these numbers are what a dean is shown, so
 * they are changed on the report itself, beside the formulas they feed. The
 * row records who changed it last (`updated_by`), which the page shows. No
 * audit event: the setting is state, and the row says who set it.
 */
const VALUE_NEVER_REASON =
  "The value report's assumptions are what a dean is shown; they are set on /admin/insights/value itself, beside the formulas they feed";

export const INSIGHTS_SET_VALUE_ASSUMPTIONS = defineAction<ValueAssumptions, object, ValueAssumptionsError>({
  id: "insights.set_value_assumptions",
  toolName: "set_value_report_assumptions",
  description:
    "Set the value report's assumptions: minutes of staff time per question, loaded hourly cost, staffed hours, term dates and what counts as handled without staff.",
  permission: "insights.configure",
  risk: "operational",
  assistant: "never",
  neverReason: VALUE_NEVER_REASON,
  input: valueAssumptionsSchema,
  invalidInput: "invalid_field",
  subject: () => ({ type: "lab_setting", id: VALUE_REPORT_SETTING }),
  run: async (input, ctx) => {
    const outcome = await setLabSetting(VALUE_REPORT_SETTING, normalizeAssumptions(input), ctx.identity.userId);
    return { ok: true, value: {}, ...(outcome.changed ? { committed: true } : {}) };
  },
  revalidate: [INSIGHTS_PATH, VALUE_REPORT_PATH],
});
