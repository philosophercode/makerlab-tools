import { getBlobStore, isBlobConfigured, type BlobStore } from "../blob";
import { getDb } from "../db/client";
import type { Db } from "../db/types";
import { findAttachmentsByIds, markAttachmentPublic } from "../data/attachments";

/**
 * Making a pending tool's photos public (spec §3.3; deferred here by the
 * 2026-09-21 Phase 3 amendment).
 *
 * A photo attached in chat is uploaded **private**, because at that moment it
 * might become a maintenance photo, and those may show a person. Once
 * `identify_tools` claims it onto a pending tool it is a picture of equipment
 * that §3.3 lists as public at a random pathname — and the intake table card
 * has to show it, which a private blob cannot do for a browser.
 *
 * Access cannot be changed in place, so each photo is **copied** to a public
 * random pathname and its row repointed. The order is the whole design:
 *
 * 1. **Copy.** If this fails nothing has changed; the photo stays private and
 *    is counted as `failed`.
 * 2. **Mark the row public**, pointing it at the copy. Never before the copy
 *    exists: a row that says public with no public blob behind it is a broken
 *    image on a tool page. If this fails the new copy is deleted again,
 *    best-effort, so it does not linger unreferenced.
 * 3. **Delete the old private blob.** A failure here is logged and the photo
 *    still counts as promoted — the row points at the public copy, and the
 *    leftover private blob is invisible and costs only storage.
 *
 * Best-effort by contract: the caller has already committed the pending rows,
 * so this never throws for one bad photo. It reports what happened and the
 * caller says so (Article 4).
 */

/** Where promoted photos go — the same prefix a tool photo uploaded directly uses. */
const PUBLIC_PREFIX = "uploads/tool/";

export interface PromoteOptions {
  db?: Db;
  /** The Blob seam. Defaults to the real store when one is configured. */
  store?: BlobStore;
}

export interface PromoteResult {
  /** Rows now public and pointing at their public copy. */
  promoted: number;
  /** Rows left private because a step before "mark public" failed. */
  failed: number;
  /** Rows already public, rows that do not exist, or every row when there is no store. */
  skipped: number;
}

export async function promoteAttachmentsToPublic(
  ids: string[],
  options: PromoteOptions = {}
): Promise<PromoteResult> {
  const unique = [...new Set(ids)];
  const result: PromoteResult = { promoted: 0, failed: 0, skipped: 0 };
  if (unique.length === 0) return result;

  // With no Blob store there is nothing to copy to; and with none, no private
  // upload can exist to begin with (`POST /api/uploads` answers 503).
  const store = options.store ?? (isBlobConfigured() ? getBlobStore() : null);
  if (!store) return { ...result, skipped: unique.length };

  const db = options.db ?? (await getDb());
  const rows = await findAttachmentsByIds(unique, { db });
  result.skipped += unique.length - rows.length;

  for (const row of rows) {
    if (row.access === "public") {
      result.skipped += 1;
      continue;
    }

    let copied: { pathname: string; url: string };
    try {
      copied = await store.copyToPublic(row.blobPathname, PUBLIC_PREFIX);
    } catch (err) {
      console.error(`[promote] could not copy attachment ${row.id} to public`, err);
      result.failed += 1;
      continue;
    }

    let marked = false;
    try {
      marked = await markAttachmentPublic(db, row.id, {
        blobPathname: copied.pathname,
        publicUrl: copied.url,
      });
    } catch (err) {
      console.error(`[promote] could not mark attachment ${row.id} public`, err);
    }
    if (!marked) {
      result.failed += 1;
      // The copy is referenced by nothing; take it back out rather than leave
      // a public file no row knows about.
      await store.del([copied.pathname]).catch((err: unknown) => {
        console.error(`[promote] could not delete unused public copy ${copied.pathname}`, err);
      });
      continue;
    }

    result.promoted += 1;
    try {
      await store.del([row.blobPathname]);
    } catch (err) {
      console.error(`[promote] could not delete private original ${row.blobPathname}`, err);
    }
  }

  return result;
}
