import "server-only";

import { del, list, put } from "@vercel/blob";

/**
 * Blob storage — one narrow seam over Vercel Blob (ops hardening design spec
 * 2026-07-29 §3.3).
 *
 * Vercel Blob is the store because it adds **no new account**: the backup job
 * has to survive a handover, and every extra provider is one more credential
 * for someone to lose. The seam exists so the job depends on three verbs it can
 * be tested against rather than on the SDK's surface.
 *
 * **Everything written here is PRIVATE, and that is not a caller's decision.**
 * The daily Notion dump contains student names and email addresses from
 * Maintenance_Logs, and a public blob URL is unauthenticated, guessable-adjacent
 * and permanent. `access: "private"` is therefore hard-coded and there is
 * deliberately no parameter to override it.
 */

/** A blob as reported by {@link BlobStore.list}. */
export interface ListedBlob {
  pathname: string;
  uploadedAt: string;
}

export interface BlobStore {
  /** Write (or replace) `pathname`. Always private. Returns the stored path. */
  put(
    pathname: string,
    body: string,
    contentType: string
  ): Promise<{ pathname: string }>;
  /** Every blob under `prefix`, following pagination to the end. */
  list(prefix: string): Promise<ListedBlob[]>;
  /** Delete by pathname. A no-op when the list is empty. */
  del(pathnames: string[]): Promise<void>;
}

/**
 * `BLOB_READ_WRITE_TOKEN` is injected by Vercel when a Blob store is linked to
 * the project, and is absent locally. Callers check this up front so a
 * misconfigured deploy fails with a clear answer instead of an SDK error buried
 * in a cron log — the whole point of §3.3 is that a backup never fails quietly.
 */
export function isBlobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/** Guards a runaway `list` loop; 30 days of daily backups is ~30 blobs. */
const MAX_LIST_PAGES = 20;

export function getBlobStore(): BlobStore {
  return {
    async put(pathname, body, contentType) {
      const result = await put(pathname, body, {
        access: "private",
        contentType,
        // The pathname *is* the retention key (`backups/YYYY-MM-DD.json`), so a
        // random suffix would leave the prune step unable to recognise its own
        // files, and a same-day re-run has to replace rather than throw.
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      return { pathname: result.pathname };
    },

    async list(prefix) {
      const blobs: ListedBlob[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
        const result = await list({ prefix, cursor });
        for (const blob of result.blobs) {
          blobs.push({
            pathname: blob.pathname,
            uploadedAt: new Date(blob.uploadedAt).toISOString(),
          });
        }
        if (!result.hasMore || !result.cursor) return blobs;
        cursor = result.cursor;
      }
      return blobs;
    },

    async del(pathnames) {
      if (pathnames.length === 0) return;
      await del(pathnames);
    },
  };
}
