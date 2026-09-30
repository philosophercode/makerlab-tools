import { markImageRetryFailed, retryImages, type ImageRetryOutcome } from "../lib/research/image-retry-steps.ts";

/**
 * `findDifferentImage` — **Find a different image** on the preliminary page
 * (amendment "Product-page first, front-facing images, reviewer notes"): the
 * research workflow's image stage, alone, for one researched item.
 *
 * Started only by `requestImageRetry` (`src/lib/intake/image-retry.ts`, behind
 * the `requestDifferentImage` server action), as `start(findDifferentImage,
 * [requestId, id, note])`, after the action has checked `tools.approve`,
 * charged one against the daily research allowance and marked the run on
 * `research.imageRetry`.
 *
 * One step, with its own deadline and retries. When it gives up, the reason is
 * recorded on the run and the item keeps the images it had — an image search
 * that failed never costs the reviewer the pictures they were already shown.
 * The page polls `research.imageRetry` and shows the result when it lands.
 */
export async function findDifferentImage(
  requestId: string,
  id: string,
  note: string | null
): Promise<ImageRetryOutcome> {
  "use workflow";
  try {
    return await retryImages(id, requestId, note);
  } catch (error) {
    try {
      await markImageRetryFailed(id, requestId, failureMessage(error));
    } catch {
      // Could not even record it; the page stops waiting once the run is stale.
    }
    return "failed";
  }
}

/** Read by shape, not `instanceof`: the workflow body runs in its own VM context. */
function failureMessage(reason: unknown): string {
  const message = typeof reason === "object" && reason !== null ? (reason as { message?: unknown }).message : reason;
  return typeof message === "string" && message ? message : "The image search failed for an unknown reason.";
}
