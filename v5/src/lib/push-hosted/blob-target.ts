import { put } from "@vercel/blob";
import type { BlobUploader } from "../import/files.ts";
import type { BlobCredentials } from "./target-env.ts";

/**
 * A Vercel Blob uploader for the hosted store, with its credentials passed
 * explicitly rather than read from `process.env` — the local side of the same
 * process may have its own (`.env.local`), and it must never be the one used.
 * A random suffix is always added, as the app's own uploads do.
 */
export function createHostedBlobUploader(credentials: BlobCredentials): BlobUploader {
  const auth =
    credentials.kind === "token"
      ? { token: credentials.token }
      : { oidcToken: credentials.oidcToken, storeId: credentials.storeId };
  return {
    async put(pathname, body, options) {
      const result = await put(pathname, Buffer.from(body.buffer, body.byteOffset, body.byteLength), {
        access: options.access,
        contentType: options.contentType,
        addRandomSuffix: true,
        ...auth,
      });
      return { pathname: result.pathname, url: result.url };
    },
  };
}
