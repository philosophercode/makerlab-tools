import "server-only";

import { copy, del, get, list, put } from "@vercel/blob";
import { createLocalBlobBackend } from "./blob-local";
import { blobCredentials, blobMode, hasPrivateBlobStore, type BlobAccess } from "./blob-mode";

export type { BlobAccess } from "./blob-mode";

/**
 * Blob storage — one narrow seam over Vercel Blob (ops hardening design spec
 * 2026-07-29 §3.3).
 *
 * Vercel Blob is the store because it adds **no new account**: the backup job
 * has to survive a handover, and every extra provider is one more credential
 * for someone to lose. The seam exists so the job depends on a handful of verbs
 * it can be tested against rather than on the SDK's surface.
 *
 * **There are two write verbs, and the split is real.** Until the data platform
 * spec (2026-09-14 §3.3) this module wrote one kind of file — the nightly dump —
 * and hard-coded `access: "private"` with `addRandomSuffix: false` because
 * neither was a caller's decision. Uploads need the opposite of both, so the
 * invariant is amended rather than worked around:
 *
 * - {@link BlobStore.put} still writes the **backup**: private, and at exactly
 *   the pathname it was given, because that pathname *is* the retention key.
 *   The dump carries student names and reporter emails from `maintenance_logs`,
 *   and a public blob URL is unauthenticated and permanent — there is still no
 *   parameter that can make it public.
 * - {@link BlobStore.putUpload} writes a **user upload** at a *random* pathname.
 *   Random because a tool image that has not been published yet must not be
 *   guessable from the tool's name, and because two students uploading
 *   `IMG_0001.jpg` must not overwrite each other. Its access is the caller's
 *   decision — a maintenance photo may show a person and stays private, while a
 *   project photo is about to be shown on a public page.
 *
 * {@link BlobStore.copyToPublic} is the third, and the only way a private file
 * becomes public: a copy at a new random pathname (spec §3.3, Phase 6). Access
 * cannot be changed in place, so the pathname changes with it.
 *
 * {@link BlobStore.read} is the one read verb, for a *private* file the app
 * serves to somebody entitled to it — the review page's background-removed
 * image (gateway spec §5.2). A public file needs no read: its URL is the read.
 *
 * **Every verb knows which store it touches** (blob stores amendment,
 * 2026-09-27). A Vercel Blob store is either all-public or all-private now, so
 * a deployment may link two; `blobCredentials(access)` (`blob-mode.ts`) picks
 * one. That is why `list` and `del` take an access too — a pathname alone does
 * not say which store holds it — and why `copyToPublic` becomes a read from the
 * private store and a write to the public one when the two differ.
 */

/** A stored file's bytes, as {@link BlobStore.read} hands them back. */
export interface ReadBlob {
  /** A stream from Vercel Blob; the bytes themselves from the local folder. */
  body: ReadableStream<Uint8Array> | Uint8Array;
  contentType: string | null;
}

/** A blob as reported by {@link BlobStore.list}. */
export interface ListedBlob {
  pathname: string;
  uploadedAt: string;
}

/** What the store recorded for an uploaded file. */
export interface StoredUpload {
  /** The *actual* pathname, random suffix included — not the one requested. */
  pathname: string;
  /** The blob URL. Only usable by an unauthenticated viewer when public. */
  url: string;
}

export interface BlobStore {
  /** Write (or replace) `pathname`. Always private. Returns the stored path. */
  put(
    pathname: string,
    body: string,
    contentType: string
  ): Promise<{ pathname: string }>;
  /**
   * Store one uploaded file under `prefix`, at a random pathname. The file's
   * own content type is kept so the browser renders it rather than downloading
   * it.
   */
  putUpload(
    prefix: string,
    file: File,
    access: BlobAccess
  ): Promise<StoredUpload>;
  /**
   * Copy an existing **private** blob to a **public**, random pathname under
   * `prefix`, keeping its file name as the stem. The source is left where it
   * is; the caller deletes it (`del(…, "private")`) once the row points at the
   * copy. With a separate private store this reads the bytes from it and
   * writes them to the public store, since `copy()` cannot cross stores.
   *
   * The one way a private upload becomes public: a photo attached in chat is
   * stored private because it might become a maintenance photo, and one that
   * lands on a pending tool is about to be shown on a tool page (spec §3.3).
   */
  copyToPublic(pathname: string, prefix: string): Promise<StoredUpload>;
  /**
   * The bytes at `pathname`, or null when there is no such blob **with that
   * access** (private by default) — the same answer the real store gives, so
   * a caller cannot read a file through the wrong door locally and then find
   * it missing on Vercel.
   */
  read(pathname: string, access?: BlobAccess): Promise<ReadBlob | null>;
  /**
   * Every blob under `prefix` in the store that holds `access` files,
   * following pagination to the end.
   */
  list(prefix: string, access: BlobAccess): Promise<ListedBlob[]>;
  /**
   * Delete by pathname from the store that holds `access` files. A no-op when
   * the list is empty.
   */
  del(pathnames: string[], access: BlobAccess): Promise<void>;
}

/**
 * `BLOB_READ_WRITE_TOKEN` is injected by Vercel when a Blob store is linked to
 * the project. Callers check this up front so a misconfigured deploy fails with
 * a clear answer instead of an SDK error buried in a cron log — the whole point
 * of §3.3 is that a backup never fails quietly.
 *
 * Without a token, local development still has a store: `.blob-data/` on disk
 * (`blob-mode.ts` decides; `blob-local.ts` is the folder). On Vercel or in a
 * production build there is no such fallback, and this stays false.
 */
export function isBlobConfigured(): boolean {
  return blobMode() !== "none";
}

/** Guards a runaway `list` loop; 30 days of daily backups is ~30 blobs. */
const MAX_LIST_PAGES = 20;

/**
 * A filename is whatever the browser sent, so it is treated as untrusted text:
 * path separators would move the file out of its prefix, and a very long name
 * is pointless once a random suffix is appended anyway. The result is cosmetic —
 * it only makes the stored path readable in the Blob dashboard.
 */
function safeFilename(name: string): string {
  const cleaned = (name || "upload")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[.-]+/, "")
    .slice(0, 64);
  return cleaned || "upload";
}

/**
 * The store for this process: Vercel Blob with a token, the `.blob-data/`
 * folder in local development without one. Callers check
 * {@link isBlobConfigured} first; the local store follows the same rules as the
 * real one (private backups at their exact path, random upload pathnames,
 * copy-to-public at a new pathname).
 */
export function getBlobStore(): BlobStore {
  return blobMode() === "local" ? localBlobStore() : vercelBlobStore();
}

function localBlobStore(): BlobStore {
  const disk = createLocalBlobBackend();
  return {
    async put(pathname, body, contentType) {
      const result = await disk.put(pathname, body, {
        access: "private",
        contentType,
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      return { pathname: result.pathname };
    },
    putUpload(prefix, file, access) {
      return disk.put(`${prefix}${safeFilename(file.name)}`, file, {
        access,
        contentType: file.type || "application/octet-stream",
        addRandomSuffix: true,
      });
    },
    copyToPublic(pathname, prefix) {
      const basename = pathname.slice(pathname.lastIndexOf("/") + 1);
      return disk.copy(pathname, `${prefix}${safeFilename(basename)}`, {
        access: "public",
        addRandomSuffix: true,
      });
    },
    async read(pathname, access = "private") {
      let blob: Awaited<ReturnType<typeof disk.read>>;
      try {
        blob = await disk.read(pathname);
      } catch {
        // A pathname that could leave the folder is refused by the disk layer;
        // to a reader it is simply not there.
        return null;
      }
      if (!blob || blob.meta.access !== access) return null;
      return { body: blob.body, contentType: blob.meta.contentType };
    },
    list(prefix) {
      return disk.list(prefix);
    },
    async del(pathnames) {
      if (pathnames.length === 0) return;
      await disk.del(pathnames);
    },
  };
}

function vercelBlobStore(): BlobStore {
  return {
    async put(pathname, body, contentType) {
      const result = await put(pathname, body, {
        ...blobCredentials("private"),
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

    async putUpload(prefix, file, access) {
      // The requested pathname is only a *stem*: `addRandomSuffix` appends
      // entropy, so `uploads/photo.jpg` becomes `uploads/photo-Xa9k2.jpg` and
      // the caller records whatever came back. The original filename is kept in
      // the `attachments` row, not relied on here — it is untrusted input.
      const result = await put(`${prefix}${safeFilename(file.name)}`, file, {
        ...blobCredentials(access),
        access,
        contentType: file.type || "application/octet-stream",
        addRandomSuffix: true,
      });
      return { pathname: result.pathname, url: result.url };
    },

    async copyToPublic(pathname, prefix) {
      const basename = pathname.slice(pathname.lastIndexOf("/") + 1);
      const destination = `${prefix}${safeFilename(basename)}`;

      if (hasPrivateBlobStore()) {
        // Two stores: `copy()` works inside one store only, so the bytes are
        // read from the private store and written to the public one. A source
        // that is not there throws, so the caller counts the photo as failed
        // and it stays private — nothing is marked public on a failure.
        const source = await get(pathname, { ...blobCredentials("private"), access: "private" });
        if (!source || source.statusCode !== 200 || !source.stream) {
          throw new Error(`copyToPublic: no private blob at ${pathname}`);
        }
        const result = await put(destination, source.stream, {
          ...blobCredentials("public"),
          access: "public",
          contentType: source.blob.contentType || "application/octet-stream",
          addRandomSuffix: true,
        });
        return { pathname: result.pathname, url: result.url };
      }

      // One store holding both kinds (no `BLOB_PRIVATE_*`): `copy()` takes the
      // new access among its options, so this is one call rather than a
      // download and a re-upload. A store created since Vercel split public
      // and private refuses a private source with a public destination — link
      // a private store then. If it refuses, the caller counts the photo as
      // failed and it stays private, which the chat card reports; nothing is
      // marked public on a failure.
      const result = await copy(pathname, destination, {
        access: "public",
        addRandomSuffix: true,
      });
      return { pathname: result.pathname, url: result.url };
    },

    async read(pathname, access = "private") {
      // `get` answers null for a blob that is not there and a 304 only to a
      // conditional request, which this never makes; either way there are no
      // bytes to hand back.
      const result = await get(pathname, { ...blobCredentials(access), access });
      if (!result || result.statusCode !== 200) return null;
      return { body: result.stream, contentType: result.blob.contentType };
    },

    async list(prefix, access) {
      const blobs: ListedBlob[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
        const result = await list({ ...blobCredentials(access), prefix, cursor });
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

    async del(pathnames, access) {
      if (pathnames.length === 0) return;
      await del(pathnames, blobCredentials(access));
    },
  };
}
