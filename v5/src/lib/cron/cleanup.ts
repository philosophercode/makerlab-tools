import type { BlobStore } from "../blob";
import { getDb } from "../db/client";
import {
  deleteAttachments,
  listOrphanedAttachments,
} from "../data/attachments";
import type { Db } from "../db/types";

/**
 * Orphaned-upload cleanup (data platform design spec §3.3, §3.9).
 *
 * `POST /api/uploads` writes an `attachments` row with no owner, because the
 * ticket or project the photo belongs to has not been written yet. Most of
 * those get claimed seconds later. The ones that do not — a student who picked
 * a photo and then closed the tab — would otherwise accumulate in Blob forever,
 * costing storage and keeping a picture of somebody nobody ever asked to keep.
 *
 * **Twenty-four hours, not one.** The window is generous on purpose: a
 * half-finished project submission left open over lunch must still be able to
 * submit its photos. Nothing here touches a claimed file, however old — that
 * file is somebody's record.
 *
 * **Blob first, then the row.** A row without a blob renders as a broken image
 * on a page; a blob without a row is invisible and gets swept on the next run.
 * Of the two half-failures, the second is the one to prefer.
 *
 * **Pending-tool cleanup (§4.10) is not here, but its bytes end up here.**
 * `runPendingExpiry` (`pending-expiry.ts`), run just before this stage in
 * `/api/cron/daily`, discards items abandoned in `identified` and releases
 * their photos — which is exactly the unowned shape this sweep already
 * collects. A pending item's picture is deleted by this function, on the same
 * run that released it, without this module knowing `pending_tools` exists.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long an upload may sit unclaimed. */
export const ORPHAN_MAX_AGE_MS = DAY_MS;

export interface CleanupResult {
  /** Rows that were unclaimed and past the window. */
  orphans: number;
  /** Blobs actually removed from the store. */
  blobsDeleted: number;
  /** Rows actually removed from Postgres. */
  rowsDeleted: number;
}

export interface CleanupOptions {
  db?: Db;
  now?: Date;
}

export async function runCleanup(
  store: BlobStore,
  options: CleanupOptions = {}
): Promise<CleanupResult> {
  const db = options.db ?? (await getDb());
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - ORPHAN_MAX_AGE_MS);

  const orphans = await listOrphanedAttachments(cutoff, { db });
  if (orphans.length === 0) {
    return { orphans: 0, blobsDeleted: 0, rowsDeleted: 0 };
  }

  const pathnames = orphans.map((row) => row.blobPathname);
  await store.del(pathnames);

  const rowsDeleted = await deleteAttachments(
    orphans.map((row) => row.id),
    { db }
  );

  return {
    orphans: orphans.length,
    blobsDeleted: pathnames.length,
    rowsDeleted,
  };
}
