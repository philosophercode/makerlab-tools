import { failFoundPhoto, finishFoundPhoto } from "../data/found-photo.ts";
import { getPendingTool } from "../data/pending-tools.ts";
import { releaseCleanedImage } from "../data/research-images.ts";
import { getDb } from "../db/client.ts";
import { imageErrorText, rankAndClean, searchProductPictures } from "../research/image-stage.ts";
import { collectCandidates } from "../research/images/candidates.ts";
import {
  IDENTIFY_PHOTO_MAX_RETRIES,
  IDENTIFY_PHOTO_MAX_SEARCHES,
  IDENTIFY_PHOTO_TIMEOUT_MS,
  RESEARCH_STEP_MAX_RETRIES,
} from "./limits.ts";

/**
 * A photo for an item named without one (data platform spec amendment "A
 * photo for a name") — the step the workflow `src/workflows/found-photos.ts`
 * runs per item, after `identify_tools` saved the rows, charged the allowance
 * and marked each lookup `searching` (`data/found-photo.ts`).
 *
 * {@link findFoundPhoto} is research's own image finder, cut down to one
 * search and one picture:
 *
 * 1. **One Exa search** for the item's name and brand (`searchProductPictures`,
 *    job `researchSearch`, flex) — the pictures its results declare.
 * 2. **Probe, rank, clean** exactly as research does (`rankAndClean`: the
 *    `imageRank` model, only the product itself kept, the deterministic cutout
 *    of rank 1 stored private, owned by the item — never a redraw).
 * 3. **Keep rank 1** as `found_photo.candidate`, with its cleaned copy; no
 *    picture is `none`. An expected failure (a model or Gateway error) is
 *    `failed` with its reason; anything else throws, the step retries, and the
 *    workflow finally records it with {@link markFoundPhotoFailed}.
 *
 * Writes only while the row's lookup is still this request's and searching;
 * a cleaned copy made for a row that moved on is let go again.
 *
 * Plain Node: step code. Relative imports only, and only steps exported — a
 * workflow bundle keeps every export of a step module.
 */

export type FoundPhotoOutcome = "found" | "none" | "failed" | "skipped";

export async function findFoundPhoto(id: string, requestId: string): Promise<FoundPhotoOutcome> {
  "use step";
  const item = await getPendingTool(id);
  const lookup = item?.foundPhoto;
  if (!item || lookup?.requestId !== requestId || lookup.status !== "searching") return "skipped";
  if (item.status === "approved" || item.status === "discarded") return "skipped";

  const signal = AbortSignal.timeout(IDENTIFY_PHOTO_TIMEOUT_MS);
  const subject = { brand: item.brand, name: item.name };
  const searched = await searchProductPictures(subject, null, { label: requestId, signal, maxSearches: IDENTIFY_PHOTO_MAX_SEARCHES });
  if (typeof searched === "string") {
    await failFoundPhoto(id, requestId, imageErrorText(searched));
    return "failed";
  }

  // Exa's pictures only: with no pages read, every one of them is a candidate (at most ten).
  const candidates = collectCandidates([], searched);
  if (candidates.length === 0) {
    return (await finishFoundPhoto(id, requestId, { status: "none", candidate: null, cleaned: null, cleanNote: null })) ? "none" : "skipped";
  }

  const db = await getDb();
  const outcome = await rankAndClean(db, id, subject.name, candidates, { signal, brand: subject.brand });
  if (!outcome.images) {
    await failFoundPhoto(id, requestId, imageErrorText(outcome.imageError ?? "The photo search failed."));
    return "failed";
  }

  // rankAndClean cleaned rank 1 only, so the cleaned copy is the kept picture's.
  const top = outcome.images.candidates[0] ?? null;
  const cleaned = top ? outcome.images.cleaned : null;
  const written = await finishFoundPhoto(id, requestId, {
    status: top ? "found" : "none",
    candidate: top,
    cleaned,
    cleanNote: top ? (outcome.images.cleanNote ?? null) : null,
  });
  if (!written) {
    if (outcome.images.cleaned) await releaseCleanedImage(db, id, outcome.images.cleaned.attachmentId);
    return "skipped";
  }
  return top ? "found" : "none";
}
findFoundPhoto.maxRetries = IDENTIFY_PHOTO_MAX_RETRIES;

/** The workflow gave up on one lookup: record why. */
export async function markFoundPhotoFailed(id: string, requestId: string, reason: string): Promise<boolean> {
  "use step";
  return failFoundPhoto(id, requestId, imageErrorText(reason));
}
markFoundPhotoFailed.maxRetries = RESEARCH_STEP_MAX_RETRIES;
