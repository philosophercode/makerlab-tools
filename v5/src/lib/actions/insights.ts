import "server-only";

import { z } from "zod";
import { CORRECTIONS_PATH } from "../../app/admin/corrections/action-result";
import { INSIGHTS_PATH, type InsightsWriteError } from "../../app/admin/insights/action-result";
import { dismissGap, fileGapCorrection } from "../data/usage-gaps";
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
