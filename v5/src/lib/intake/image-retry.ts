import "server-only";
import { randomUUID } from "node:crypto";
import { start } from "workflow/api";
import { failImageRetry, startImageRetry } from "../data/image-retry";
import { findDifferentImage } from "../../workflows/image-retry";
import { RESEARCH_DAILY_ITEM_LIMIT } from "./limits";

/**
 * **Find a different image**, after the server action's gate (amendment
 * "Product-page first, front-facing images, reviewer notes"): mark the run and
 * charge the allowance in one transaction (`data/image-retry.ts`), then start
 * `findDifferentImage`.
 *
 * Importing the workflow here is also what makes `next build` compile it, as
 * the research route does for `researchBatch`.
 *
 * **A start that throws says so.** The run is marked failed with the reason at
 * once — the page would otherwise wait on a run that never began until it went
 * stale — and the answer is `start_failed`. The allowance stays spent, as a
 * Research press whose start failed stays spent: the ledger counts presses.
 */

export type ImageRetryRequestResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "not_editable" | "image_retry_running" | "daily_limit" | "start_failed" };

const DAY_MS = 24 * 60 * 60_000;

export async function requestImageRetry(
  by: { userId: string },
  input: { id: string; note: string | null }
): Promise<ImageRetryRequestResult> {
  const requestId = randomUUID();
  const started = await startImageRetry(input.id, {
    requestedBy: by.userId,
    requestId,
    note: input.note,
    limit: RESEARCH_DAILY_ITEM_LIMIT,
    since: new Date(Date.now() - DAY_MS),
  });
  if (!started.ok) return { ok: false, error: started.reason };

  try {
    await start(findDifferentImage, [requestId, input.id, input.note]);
  } catch (error) {
    const name = error instanceof Error ? error.name : "unknown error";
    console.error(`[research] could not start an image search for request ${requestId}: ${name}`);
    await failImageRetry(input.id, requestId, "The image search could not start. Try again.");
    return { ok: false, error: "start_failed" };
  }
  return { ok: true };
}
