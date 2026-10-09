import { IDENTIFY_PHOTO_CONCURRENCY } from "../lib/intake/limits.ts";
import { findFoundPhoto, markFoundPhotoFailed, type FoundPhotoOutcome } from "../lib/intake/found-photo-steps.ts";

/**
 * `findFoundPhotos` — one candidate product photo for each item the chat
 * recorded from its name alone (data platform spec amendment "A photo for a
 * name").
 *
 * Started only by `startFoundPhotos` (`src/lib/intake/found-photo-start.ts`,
 * called by `identify_tools` after its rows are saved), as
 * `start(findFoundPhotos, [requestId, ids])`, after the allowance was charged
 * and each lookup marked `searching`.
 *
 * **Three at a time, in fixed chunks** — `chunk` + `Promise.allSettled`, like
 * `researchBatch`, so a replay issues the same steps in the same order. One
 * step per item (`findFoundPhoto`), with its own deadline and retry; when it
 * gives up, the reason is recorded on that item and the rest carry on. A
 * lookup that never lands is shown as no photo once it is stale
 * (`IDENTIFY_PHOTO_STALE_MS`).
 */
export async function findFoundPhotos(requestId: string, ids: string[]): Promise<Record<FoundPhotoOutcome, number>> {
  "use workflow";
  const counts: Record<FoundPhotoOutcome, number> = { found: 0, none: 0, failed: 0, skipped: 0 };
  for (const group of chunk(ids, IDENTIFY_PHOTO_CONCURRENCY)) {
    const settled = await Promise.allSettled(group.map((id) => findFoundPhoto(id, requestId)));
    for (let i = 0; i < group.length; i += 1) {
      const outcome = settled[i];
      if (outcome.status === "fulfilled") {
        counts[outcome.value] += 1;
        continue;
      }
      counts.failed += 1;
      try {
        await markFoundPhotoFailed(group[i], requestId, failureMessage(outcome.reason));
      } catch {
        // Could not even record it; the card stops waiting once the lookup is stale.
      }
    }
  }
  return counts;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Read by shape, not `instanceof`: the workflow body runs in its own VM context. */
function failureMessage(reason: unknown): string {
  const message = typeof reason === "object" && reason !== null ? (reason as { message?: unknown }).message : reason;
  return typeof message === "string" && message ? message : "The photo search failed for an unknown reason.";
}
