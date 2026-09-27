import "server-only";

import { z } from "zod";
import { CORRECTIONS_PATH, type CorrectionWriteError } from "../../app/admin/corrections/action-result";
import { updateFeedbackStatus } from "../data/feedback";
import { defineAction } from "./define";

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
  run: async (input, ctx) => {
    const outcome = await updateFeedbackStatus(input.feedbackId, input.status, { actorUserId: ctx.identity.userId });
    if (!outcome.ok) return { ok: false, error: outcome.reason };
    return { ok: true, value: {}, committed: true };
  },
  revalidate: [CORRECTIONS_PATH],
});
