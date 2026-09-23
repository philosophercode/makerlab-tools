import {
  deleteDiscardedPendingTools,
  expireIdentifiedPendingTools,
  failAbandonedResearch,
  releasePhotosOfMissingPendingTools,
} from "../data/pending-tools";
import { getDb } from "../db/client";
import type { Db } from "../db/types";
import {
  PENDING_DISCARDED_RETENTION_MS,
  PENDING_IDENTIFIED_TTL_MS,
  RESEARCH_ABANDONED_AFTER_MS,
} from "../intake/limits";

/**
 * The daily cron's pending-tool expiry (spec §4.10, Phase 6 amendment).
 *
 * An item left `identified` — proposed in the chat and never even sent to
 * research — for longer than {@link PENDING_IDENTIFIED_TTL_MS} (14 days) is an
 * abandoned batch, not something anybody is coming back to finish. This stage
 * discards it, which releases its photos (`expireIdentifiedPendingTools`
 * already does both in one transaction — see `src/lib/data/pending-tools.ts`).
 *
 * **It does not delete the photos itself.** A released attachment is
 * unowned — exactly the shape `POST /api/uploads` leaves an upload in — so the
 * orphan sweep that already exists for that shape (`runCleanup`, run right
 * after this stage in `src/app/api/cron/daily/route.ts`) is what removes it
 * from Blob and then from `attachments`, with the retry behaviour that path
 * already has. Two sweeps for one shape of row would be the odd one out.
 *
 * Only `identified` rows are ever discarded — `expireIdentifiedPendingTools`
 * scopes to that status by construction — so a queued, researching or
 * researched item is never discarded by a cron: once research has started, the
 * decision belongs to a person (Article 5).
 *
 * **It also frees items an abandoned run is still holding.** Research requested
 * more than {@link RESEARCH_ABANDONED_AFTER_MS} ago and still `researching`
 * (or `queued` under a run) moves to `failed`, with a reason, so the person can
 * research it again or discard it (`failAbandonedResearch`). That is a status a
 * person acts on, not a decision made for them. The same goes for an item left
 * `queued` by a start that never happened.
 *
 * **And it deletes what was thrown away** (§8 PII). A discarded item is deleted
 * {@link PENDING_DISCARDED_RETENTION_MS} after it was discarded, so the queue's
 * history cannot grow for ever and a name nobody wanted is not kept. Photos
 * still owned by a pending item that no longer exists — a removed person's
 * items cascade with them — are released; like every other released photo,
 * the orphan sweep that runs next deletes them.
 */

export interface PendingExpiryOptions {
  /** A handle to use instead of {@link getDb} — tests pass an isolated one. */
  db?: Db;
  /** Clock injection, so a test can stage the 14-day window without waiting. */
  now?: Date;
}

export interface PendingExpiryResult {
  discarded: number;
  releasedAttachments: number;
  /** Items an abandoned research run was holding, now `failed`. */
  abandoned: number;
  /** Discarded items past their retention, deleted. */
  deleted: number;
  /** Photos released because the pending item that owned them is gone. */
  releasedOrphanPhotos: number;
}

export async function runPendingExpiry(
  options: PendingExpiryOptions = {}
): Promise<PendingExpiryResult> {
  const db = options.db ?? (await getDb());
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - PENDING_IDENTIFIED_TTL_MS);

  const { discarded, releasedAttachments } = await expireIdentifiedPendingTools(cutoff, { db });
  const abandoned = await failAbandonedResearch(
    new Date(now.getTime() - RESEARCH_ABANDONED_AFTER_MS),
    { db }
  );
  const purged = await deleteDiscardedPendingTools(
    new Date(now.getTime() - PENDING_DISCARDED_RETENTION_MS),
    { db }
  );
  const releasedOrphanPhotos = await releasePhotosOfMissingPendingTools({ db });
  return {
    discarded: discarded.length,
    releasedAttachments: releasedAttachments + purged.releasedAttachments,
    abandoned: abandoned.length,
    deleted: purged.deleted,
    releasedOrphanPhotos,
  };
}
