/**
 * The hosts `next/image` may fetch and optimize (`next.config.ts`'s
 * `images.remotePatterns`).
 *
 * `/_next/image` is unauthenticated, and every distinct source URL, width and
 * quality is a billed fetch and transform. So the list names the lab's own
 * public Blob store and nothing else: a wildcard over
 * `*.public.blob.vercel-storage.com` (every Vercel customer's store) or the
 * path-style `s3.us-west-2.amazonaws.com` (every bucket in the region) let
 * anyone run their own images through the lab's optimizer, on the lab's bill
 * (security fix, 2026-10-05; data platform spec amendment of that date).
 *
 * The store's host is derived at build time from the credential that links it
 * — `BLOB_STORE_ID` (`store_<id>`) or `BLOB_READ_WRITE_TOKEN`
 * (`vercel_blob_rw_<id>_<secret>`) — the same way `@vercel/blob` builds its
 * URLs (`https://<id>.public.blob.vercel-storage.com/…`). Only the id is read;
 * the token's secret part is never kept. Private stores are left out: their
 * URLs need a token, so the optimizer could not fetch them anyway.
 *
 * Plain Node, no imports: `next.config.ts` loads it.
 */

export interface BlobImagePattern {
  protocol: "https";
  hostname: string;
}

type Env = Record<string, string | undefined>;

/** The store id a credential names, lower-cased for a hostname; null when none. */
export function publicBlobStoreId(env: Env): string | null {
  const storeId = env.BLOB_STORE_ID?.trim().replace(/^store_/, "");
  if (storeId && /^[A-Za-z0-9]+$/.test(storeId)) return storeId.toLowerCase();
  const token = env.BLOB_READ_WRITE_TOKEN?.trim();
  const match = token ? /^vercel_blob_rw_([A-Za-z0-9]+)_/.exec(token) : null;
  return match ? match[1].toLowerCase() : null;
}

/** The lab's public Blob store as a `remotePatterns` entry, or none when no store is linked. */
export function blobImagePatterns(env: Env): BlobImagePattern[] {
  const id = publicBlobStoreId(env);
  return id ? [{ protocol: "https", hostname: `${id}.public.blob.vercel-storage.com` }] : [];
}
