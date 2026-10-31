import { markPhotoSearchFailed, searchPhotoOptions, type PhotoSearchOutcome } from "../lib/research/photo-options-steps.ts";

/**
 * `findPhotoOptions` — **Find photo options** in the tool editor's Photos
 * section (photo options spec 2026-10-29): candidate cover pictures for one
 * catalogue tool.
 *
 * Started only by `requestPhotoOptions` (`src/lib/photo-options/request.ts`),
 * as `start(findPhotoOptions, [searchId])`, after the action has checked
 * `tools.edit`, charged one against the daily research allowance and written
 * the `searching` row.
 *
 * One step, with its own deadline and retries. When it gives up, the reason is
 * recorded on the row; the tool's photos are never touched by a search. The
 * editor polls the row and shows the pictures when they land.
 */
export async function findPhotoOptions(searchId: string): Promise<PhotoSearchOutcome> {
  "use workflow";
  try {
    return await searchPhotoOptions(searchId);
  } catch (error) {
    try {
      await markPhotoSearchFailed(searchId, failureMessage(error));
    } catch {
      // Could not even record it; the editor stops waiting once the row is stale.
    }
    return "failed";
  }
}

/** Read by shape, not `instanceof`: the workflow body runs in its own VM context. */
function failureMessage(reason: unknown): string {
  const message = typeof reason === "object" && reason !== null ? (reason as { message?: unknown }).message : reason;
  return typeof message === "string" && message ? message : "The photo search failed for an unknown reason.";
}
