import "server-only";
import { randomUUID } from "node:crypto";
import { start } from "workflow/api";
import { failFoundPhoto, startFoundPhotoSearch } from "../data/found-photo";
import { researchLimitFor } from "../data/research-allowances";
import { findFoundPhotos } from "../../workflows/found-photos";
import { foundPhotoEligible, type FoundPhotoSubject } from "./found-photo";
import { IDENTIFY_PHOTO_MAX_ITEMS } from "./limits";

/**
 * Start the photo lookups for a batch `identify_tools` just saved (data
 * platform spec amendment "A photo for a name"): pick the items named without
 * a photo (`foundPhotoEligible`), at most `IDENTIFY_PHOTO_MAX_ITEMS`; charge
 * the daily research allowance a quarter item each and mark them `searching`
 * in one transaction (`data/found-photo.ts`); then start `findFoundPhotos`.
 *
 * Importing the workflow here is what makes `next build` compile it.
 *
 * **Never a reason to fail the identification.** A start that throws marks
 * each lookup `failed` with the reason (the charge stays spent, as a Research
 * press whose start failed stays spent: the ledger counts presses), and the
 * caller says so in the tool's answer. The allowance running out simply means
 * fewer lookups.
 */

export interface FoundPhotoStart {
  /** Lookups now running. */
  searching: number;
  /** Items named without a photo that got none: past the per-call cap, or past today's allowance. */
  skipped: { cap: number; allowance: number };
  /** The workflow would not start; the lookups were marked failed. */
  startFailed?: true;
}

const DAY_MS = 24 * 60 * 60_000;

export async function startFoundPhotos(userId: string, items: readonly FoundPhotoSubject[]): Promise<FoundPhotoStart> {
  const eligible = foundPhotoEligible(items);
  const capped = eligible.slice(0, IDENTIFY_PHOTO_MAX_ITEMS);
  const cap = eligible.length - capped.length;
  if (capped.length === 0) return { searching: 0, skipped: { cap, allowance: 0 } };

  const requestId = randomUUID();
  const started = await startFoundPhotoSearch(capped, {
    requestedBy: userId,
    requestId,
    limit: await researchLimitFor(userId),
    since: new Date(Date.now() - DAY_MS),
  });
  const skipped = { cap, allowance: started.unaffordable };
  if (started.started.length === 0) return { searching: 0, skipped };

  try {
    await start(findFoundPhotos, [requestId, started.started]);
  } catch (error) {
    const name = error instanceof Error ? error.name : "unknown error";
    console.error(`[intake] could not start the photo lookups for request ${requestId}: ${name}`);
    for (const id of started.started) await failFoundPhoto(id, requestId, "The photo search could not start.").catch(() => false);
    return { searching: 0, skipped, startFailed: true };
  }
  return { searching: started.started.length, skipped };
}
