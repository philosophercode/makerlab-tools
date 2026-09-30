import "server-only";

import { z } from "zod";
import { CORRECTIONS_PATH, type CorrectionWriteError } from "../../app/admin/corrections/action-result";
import { correctionSubjects } from "../data/action-subjects";
import { updateFeedbackStatus } from "../data/feedback";
import { FEEDBACK_STATUS } from "../db/schema/vocabulary";
import { defineAction, toolShape } from "./define";
import { recordIds } from "./tool-args";

/**
 * Triaging a correction (spec §4.6 #42): mark it `reviewed`, `fixed`,
 * `dismissed` — or back to `new`, because a dismissal is a judgement somebody
 * made in a hurry.
 *
 * `feedback.manage`, which is not `tools.edit`: a caller who may fix the field
 * is still refused the queue. **The status is the whole write** — changing the
 * catalogue happens in the tool editor, which keeps a student's report inert:
 * there is no path from the sentence to the field, only to a person. No audit
 * event (§4.11) and no cache invalidation (nothing cached reads `feedback`).
 */
export const CORRECTIONS_SET_STATUS = defineAction<
  { feedbackId: string; status: string },
  object,
  CorrectionWriteError
>({
  id: "corrections.set_status",
  toolName: "set_correction_status",
  description:
    "Set one correction's status: new, reviewed, fixed or dismissed. Changes nothing in the catalogue itself.",
  permission: "feedback.manage",
  risk: "operational",
  maxBatch: 20,
  input: z.object({ feedbackId: z.string(), status: z.string() }),
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "feedback", id: input.feedbackId }),
  tool: toolShape(
    z.strictObject({
      correction_ids: recordIds("corrections"),
      status: z.enum(FEEDBACK_STATUS).describe("new, reviewed, fixed or dismissed"),
    }),
    (args) => ({ ok: true, inputs: args.correction_ids.map((feedbackId) => ({ feedbackId, status: args.status })) })
  ),
  preview: async (input) => {
    const [correction] = await correctionSubjects([input.feedbackId]);
    if (!correction) return null;
    const name = correction.fieldFlagged ? `${correction.toolName || "—"} · ${correction.fieldFlagged}` : correction.toolName || "—";
    return {
      summary: { key: "corrections_set_status", values: { name } },
      rows: [{ field: "status", before: correction.status, after: input.status, format: "correctionStatus" }],
      subjectName: name,
      link: CORRECTIONS_PATH,
    };
  },
  run: async (input, ctx) => {
    const outcome = await updateFeedbackStatus(input.feedbackId, input.status, { actorUserId: ctx.identity.userId });
    if (!outcome.ok) return { ok: false, error: outcome.reason };
    return { ok: true, value: {}, committed: true };
  },
  revalidate: [CORRECTIONS_PATH],
});
