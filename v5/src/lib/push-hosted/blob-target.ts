import { BlobNotFoundError, head, put } from "@vercel/blob";
import type { BlobUploader } from "../import/files.ts";
import type { BlobCredentials } from "./target-env.ts";

/**
 * The uploader, plus a check that a file is still in the store its access maps
 * to — so a re-run never reuses an earlier push's copy from a store that has
 * since been deleted or replaced.
 */
export interface HostedBlobUploader extends BlobUploader {
  exists(pathname: string, access: "public" | "private"): Promise<boolean>;
}

function authFor(credentials: BlobCredentials) {
  return credentials.kind === "token"
    ? { token: credentials.token }
    : { oidcToken: credentials.oidcToken, storeId: credentials.storeId };
}

/**
 * A Vercel Blob uploader for the hosted store(s), with credentials passed
 * explicitly rather than read from `process.env` — the local side of the same
 * process may have its own (`.env.local`), and it must never be the one used.
 * Private files go to `privateCredentials` when the deployment has a private
 * store (a Vercel store is all-public or all-private); otherwise one store holds
 * both, as before. A random suffix is always added, as the app's own uploads do.
 */
export function createHostedBlobUploader(
  credentials: BlobCredentials,
  privateCredentials: BlobCredentials | null = null
): HostedBlobUploader {
  const publicAuth = authFor(credentials);
  const privateAuth = privateCredentials ? authFor(privateCredentials) : publicAuth;
  return {
    async put(pathname, body, options) {
      const result = await put(pathname, Buffer.from(body.buffer, body.byteOffset, body.byteLength), {
        access: options.access,
        contentType: options.contentType,
        addRandomSuffix: true,
        ...(options.access === "private" ? privateAuth : publicAuth),
      });
      return { pathname: result.pathname, url: result.url };
    },
    async exists(pathname, access) {
      try {
        await head(pathname, access === "private" ? privateAuth : publicAuth);
        return true;
      } catch (error) {
        if (error instanceof BlobNotFoundError) return false;
        throw error;
      }
    },
  };
}
