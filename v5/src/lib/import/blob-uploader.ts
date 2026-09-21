import { put } from "@vercel/blob";
import type { BlobUploader } from "./files.ts";

/**
 * The real uploader: Vercel Blob through `@vercel/blob`, authenticated by
 * `BLOB_READ_WRITE_TOKEN`. A random suffix is always added so a pathname can
 * never be guessed from a filename, and so two files with the same name under
 * one owner never collide.
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
