import type { Citation } from "../refresh/types.ts";
import type { ResearchResult } from "../research/result.ts";

/**
 * Whether a new tool needs training is the lab's call, not research's
 * (research fixes amendment 2026-09-24, "Training is the lab's call", in the
 * gateway spec — the same decision as PPE).
 *
 * - **Research never decides it for a pending item.** The read step's draft
 *   leaves `trainingRequired` null — "staff to confirm" — whatever the model
 *   said ({@link withTrainingForStaff}). What a page said about training
 *   survives as evidence: the verified quotes under `citations.training_required`
 *   ({@link trainingEvidence}), shown beside the choice.
 * - **Unconfirmed ships as required.** The preliminary page starts every item
 *   at "staff to confirm"; approving it without a choice stores `true`
 *   ({@link trainingAtApproval}). Only a reviewer's explicit "No training
 *   needed" stores `false`.
 * - **Refresh is unchanged:** it never turns training off on a catalogue tool
 *   (`refresh/lab-rules.ts`).
 *
 * Pure and client-safe: the review page and the read step both import it.
 */

/** The research result with training left for staff: `null`, whatever the model proposed. */
export function withTrainingForStaff(result: ResearchResult): ResearchResult {
  return result.trainingRequired === null ? result : { ...result, trainingRequired: null };
}

/** What approval stores for the reviewer's choice: unconfirmed (`null`) is required. */
export function trainingAtApproval(choice: boolean | null): boolean {
  return choice ?? true;
}

/** The quotes research verified on a page about training — evidence for the reviewer, never a value. */
export function trainingEvidence(research: Pick<ResearchResult, "citations"> | null | undefined): Citation[] {
  return (research?.citations?.training_required ?? []).filter((citation) => citation.verified);
}
