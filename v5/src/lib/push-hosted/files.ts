import type { LocalBlobBackend } from "../blob-local.ts";
import type { BlobUploader } from "../import/files.ts";
import { isLocalBlobUrl, localPathnameFromUrl, type Rewrites, type Row, type UploadedFile } from "./rows.ts";

/**
 * The files `npm run data:push` has to carry: every `attachments` row whose
 * bytes live in the local store (`.blob-data/`, `blob-local.ts`).
 *
 * A row is local when its `public_url` is a `/api/dev-blob/…` URL on this
 * laptop, or — a private file, which has no URL — when the local store holds
 * its `blob_pathname`. Anything else (a Vercel Blob URL, a bundled
 * `/tool-images/…` path) already works on the hosted site and is left alone.
 */

export interface LocalFile {
  /** Pathname in the local store (the dedupe key: one upload per file). */
  pathname: string;
  access: "public" | "private";
  contentType: string;
  size: number;
  /** Every URL the database uses for this file (rewritten to the new one). */
  urls: string[];
  /** Attachment rows pointing at it, with the size each records. */
  rows: { id: string; sizeBytes: number | null }[];
}

export interface LocalFileScan {
  files: LocalFile[];
  /** Local rows whose bytes are gone from `.blob-data/`. */
  missing: { id: string; pathname: string }[];
  bytes: number;
}

export async function scanLocalFiles(
  attachments: Row[],
  store: LocalBlobBackend,
  origin?: string
): Promise<LocalFileScan> {
  const files = new Map<string, LocalFile>();
  const missing: LocalFileScan["missing"] = [];

  for (const row of attachments) {
    const id = String(row.id);
    const publicUrl = typeof row.public_url === "string" ? row.public_url : null;
    const blobPathname = typeof row.blob_pathname === "string" ? row.blob_pathname : "";
    let pathname: string;
    if (publicUrl) {
      if (!isLocalBlobUrl(publicUrl, origin)) continue;
      pathname = blobPathname || localPathnameFromUrl(publicUrl);
    } else {
      pathname = blobPathname;
    }
    if (!pathname) continue;

    const ref = { id, sizeBytes: typeof row.size_bytes === "number" ? row.size_bytes : null };
    const known = files.get(pathname);
    if (known) {
      known.rows.push(ref);
      if (publicUrl && !known.urls.includes(publicUrl)) known.urls.push(publicUrl);
      continue;
    }

    let stored: Awaited<ReturnType<LocalBlobBackend["read"]>> = null;
    try {
      stored = await store.read(pathname);
    } catch {
      stored = null; // an invalid pathname cannot be in the store
    }
    if (!stored) {
      // A private file not in the store is taken to be in Vercel Blob already;
      // a local URL with no bytes behind it is a broken row.
      if (publicUrl) missing.push({ id, pathname });
      continue;
    }

    files.set(pathname, {
      pathname,
      access: row.access === "private" ? "private" : "public",
      contentType: (typeof row.content_type === "string" && row.content_type) || stored.meta.contentType,
      size: stored.body.byteLength,
      urls: publicUrl ? [publicUrl] : [],
      rows: [ref],
    });
  }

  const list = [...files.values()].sort((a, b) => a.pathname.localeCompare(b.pathname));
  return { files: list, missing, bytes: list.reduce((sum, f) => sum + f.size, 0) };
}

/**
 * Files an earlier push already uploaded, so a re-run does not store every
 * photo and manual again. A hosted `attachments` row is taken as the earlier
 * copy of a local file when it has the same id, the same access and recorded
 * size, and a pathname this script would have produced from the local one
 * (`<dir>/<name>-<random suffix><ext>`, see {@link uploadFiles}).
 */
export function findEarlierUploads(files: LocalFile[], hostedAttachments: Row[]): Map<string, UploadedFile> {
  const hosted = new Map(hostedAttachments.map((row) => [String(row.id), row]));
  const found = new Map<string, UploadedFile>();
  for (const file of files) {
    const dot = file.pathname.lastIndexOf(".");
    const slash = file.pathname.lastIndexOf("/");
    const stem = dot > slash + 1 ? file.pathname.slice(0, dot) : file.pathname;
    const ext = dot > slash + 1 ? file.pathname.slice(dot) : "";
    const shape = new RegExp(`^${escapeRegExp(stem)}-[A-Za-z0-9]+${escapeRegExp(ext)}$`);
    for (const ref of file.rows) {
      const row = hosted.get(ref.id);
      if (!row || row.access !== file.access || typeof row.blob_pathname !== "string") continue;
      if (!shape.test(row.blob_pathname) || row.size_bytes !== ref.sizeBytes) continue;
      const url = typeof row.public_url === "string" ? row.public_url : "";
      if (file.access === "public" && !/^https:\/\//.test(url)) continue;
      found.set(file.pathname, { pathname: row.blob_pathname, url, access: file.access });
      break;
    }
  }
  return found;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** An upload failed part-way; `uploaded` are the copies already made (left in Blob). */
export class UploadFailedError extends Error {
  readonly uploaded: string[];
  readonly pathname: string;
  constructor(pathname: string, uploaded: string[], cause: unknown) {
    super(`Uploading ${pathname} failed: ${(cause as Error)?.message ?? String(cause)}`);
    this.name = "UploadFailedError";
    this.pathname = pathname;
    this.uploaded = uploaded;
  }
}

/**
 * Upload each file once, in order, and return the rewrite table. Stops at the
 * first failure (nothing has touched the database yet) and reports what was
 * already uploaded.
 */
export async function uploadFiles(
  files: LocalFile[],
  store: LocalBlobBackend,
  uploader: BlobUploader | null,
  onProgress: (done: number, total: number, file: LocalFile) => void = () => {},
  earlier: Map<string, UploadedFile> = new Map()
): Promise<Rewrites> {
  const rewrites: Rewrites = { byPathname: new Map(), byUrl: new Map() };
  for (const file of files) {
    const reused = earlier.get(file.pathname);
    if (!reused) continue;
    rewrites.byPathname.set(file.pathname, reused);
    if (file.access === "public") for (const url of file.urls) rewrites.byUrl.set(url, reused.url);
  }
  const toUpload = files.filter((file) => !earlier.has(file.pathname));
  const uploaded: string[] = [];
  let done = 0;
  for (const file of toUpload) {
    try {
      if (!uploader) throw new Error("no Blob store to upload to");
      const stored = await store.read(file.pathname);
      if (!stored) throw new Error("the file disappeared from the local store");
      const result = await uploader.put(file.pathname, stored.body, {
        access: file.access,
        contentType: file.contentType,
      });
      uploaded.push(result.pathname);
      rewrites.byPathname.set(file.pathname, { pathname: result.pathname, url: result.url, access: file.access });
      if (file.access === "public") for (const url of file.urls) rewrites.byUrl.set(url, result.url);
    } catch (error) {
      throw new UploadFailedError(file.pathname, uploaded, error);
    }
    done += 1;
    onProgress(done, toUpload.length, file);
  }
  return rewrites;
}
