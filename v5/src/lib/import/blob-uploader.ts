import { put } from "@vercel/blob";
import { createLocalBlobBackend } from "../blob-local.ts";
import { blobMode } from "../blob-mode.ts";
import type { BlobUploader } from "./files.ts";

/**
 * The real uploader: Vercel Blob through `@vercel/blob`, authenticated by
 * `BLOB_READ_WRITE_TOKEN`. A random suffix is always added so a pathname can
 * never be guessed from a filename, and so two files with the same name under
 * one owner never collide.
 *
 * The Notion import calls this directly and so still insists on a token: its
 * rows go to `DATABASE_URL`, and a shared database must not end up pointing at
 * files on one person's laptop.
 */
export function createVercelBlobUploader(): BlobUploader {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is not set; cannot copy files to Vercel Blob.");
  }
  return {
    async put(pathname, body, options) {
      const result = await put(pathname, Buffer.from(body.buffer, body.byteOffset, body.byteLength), {
        access: options.access,
        contentType: options.contentType,
        addRandomSuffix: true,
      });
      return { pathname: result.pathname, url: result.url };
    },
  };
}

/** The same contract against `.blob-data/` (see `blob-local.ts`). */
export function createLocalBlobUploader(): BlobUploader {
  const disk = createLocalBlobBackend();
  return {
    put(pathname, body, options) {
      return disk.put(pathname, body, {
        access: options.access,
        contentType: options.contentType,
        addRandomSuffix: true,
      });
    },
  };
}

/**
 * Whichever uploader `blobMode()` allows, or null when there is no store —
 * the step-code counterpart of `lib/blob.ts`'s `getBlobStore()`.
 */
export function createBlobUploader(): BlobUploader | null {
  switch (blobMode()) {
    case "vercel":
      return createVercelBlobUploader();
    case "local":
      return createLocalBlobUploader();
    default:
      return null;
  }
}
