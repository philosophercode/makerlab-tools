/**
 * Which Blob store this process writes to — the one rule, in one place.
 *
 * - `"vercel"` — a Vercel Blob store is linked: `BLOB_READ_WRITE_TOKEN` (a
 *   store connected the old way) or `BLOB_STORE_ID` (connected the current way;
 *   `@vercel/blob` then authenticates with the deployment's OIDC token).
 * - `"local"` — no token, not on Vercel, not a production build, and not
 *   switched off with `BLOB_LOCAL_DISABLE=1`: files go to `.blob-data/` in the
 *   working directory (`blob-local.ts`), so uploads, promotion, archived
 *   manuals, backups and the orphan sweep all work on a laptop.
 * - `"none"` — anything else. A deploy without a linked store keeps failing
 *   loudly (`blob_not_configured`, 503); it never falls back to a disk that
 *   would vanish with the function instance. The test suites set
 *   `BLOB_LOCAL_DISABLE=1` (vitest.setup.ts) so "no token" still means "none"
 *   there unless a test opts in.
 *
 * One test-only exception: `BLOB_LOCAL_DIR` (an explicit folder) also allows
 * the local store in a production build, so the intake E2E's `next start`
 * server can store and serve the cleaned product image (gateway spec §10,
 * scenario 5; playwright.config.ts). It is still never honoured on Vercel.
 *
 * **Two stores, one rule for which** (blob stores amendment, 2026-09-27). A
 * Vercel Blob store is now either all-public or all-private, so a deployment
 * that keeps both kinds of file links two: the default one (public — tool
 * photos, archived manuals, research images) and a private one connected with
 * the custom prefix `BLOB_PRIVATE` (the nightly backup, private uploads,
 * research's private cleaned copies). {@link blobCredentials} is the one place
 * that picks the store for an access; `blobMode()` still only asks whether the
 * default store is linked, exactly as before. With no `BLOB_PRIVATE_*`
 * variable, private files go to the default store too — an older store that
 * holds both kinds, or local development.
 *
 * Not `server-only`: the manual archiver and the Notion import run under plain
 * Node, where that package throws. Relative, `.ts`-suffixed imports only.
 */
export type BlobMode = "vercel" | "local" | "none";

/** A Vercel Blob store is linked, by token or by store id + OIDC (see {@link blobMode}). */
export function hasVercelBlobStore(): boolean {
  // The default store only: a private store on its own cannot hold a tool
  // photo, so it does not make `blobMode()` "vercel".
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim() || process.env.BLOB_STORE_ID?.trim());
}

export function blobMode(): BlobMode {
  if (hasVercelBlobStore()) return "vercel";
  if (process.env.VERCEL) return "none";
  const explicitDir = (process.env.BLOB_LOCAL_DIR ?? "").trim();
  if (process.env.NODE_ENV === "production" && !explicitDir) return "none";
  const disabled = (process.env.BLOB_LOCAL_DISABLE ?? "").trim().toLowerCase();
  if (disabled && disabled !== "0" && disabled !== "false") return "none";
  return "local";
}

/** Whether a stored file is reachable by URL. Mirrors `attachments.access`. */
export type BlobAccess = "public" | "private";

/**
 * The credential options to spread into an `@vercel/blob` call, so it reaches
 * the store that holds files of this `access`. Empty means "the SDK's own
 * default" — `BLOB_READ_WRITE_TOKEN`, or `BLOB_STORE_ID` with the deployment's
 * OIDC token — which is exactly what every call did before there were two
 * stores.
 */
export interface BlobCredentials {
  token?: string;
  storeId?: string;
}

/**
 * A separate private store is linked (`BLOB_PRIVATE_READ_WRITE_TOKEN`, or
 * `BLOB_PRIVATE_STORE_ID` + OIDC). Only meaningful alongside a default store
 * (`hasVercelBlobStore()`); on its own it changes nothing.
 */
export function hasPrivateBlobStore(): boolean {
  return Boolean(
    process.env.BLOB_PRIVATE_READ_WRITE_TOKEN?.trim() || process.env.BLOB_PRIVATE_STORE_ID?.trim()
  );
}

/**
 * Which store a Vercel Blob call for `access` should use:
 *
 * - `public` — always the default store (`{}`).
 * - `private` — the private store when one is linked: its read-write token
 *   first (an explicit `token` beats every other credential in the SDK, so it
 *   cannot be shadowed), else its store id, which the SDK pairs with the
 *   deployment's OIDC token. With neither, the default store (`{}`): a single
 *   store holding both kinds, as before the split.
 *
 * A store id without an OIDC token (a script run outside Vercel with no
 * `VERCEL_OIDC_TOKEN`) makes the SDK fall back to the default token, i.e. the
 * **public** store, which refuses a private write outright — a loud failure,
 * never a private file made public. That is why the deploy guide asks for the
 * private store's read-write token.
 */
export function blobCredentials(access: BlobAccess): BlobCredentials {
  if (access === "public") return {};
  const token = process.env.BLOB_PRIVATE_READ_WRITE_TOKEN?.trim();
  if (token) return { token };
  const storeId = process.env.BLOB_PRIVATE_STORE_ID?.trim();
  if (storeId) return { storeId };
  return {};
}
