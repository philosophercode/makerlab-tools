/**
 * Which Blob store this process writes to — the one rule, in one place.
 *
 * - `"vercel"` — `BLOB_READ_WRITE_TOKEN` is set: the real Vercel Blob store.
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
 * Not `server-only`: the manual archiver and the Notion import run under plain
 * Node, where that package throws. Relative, `.ts`-suffixed imports only.
 */
export type BlobMode = "vercel" | "local" | "none";

export function blobMode(): BlobMode {
  if (process.env.BLOB_READ_WRITE_TOKEN) return "vercel";
  if (process.env.VERCEL) return "none";
  const explicitDir = (process.env.BLOB_LOCAL_DIR ?? "").trim();
  if (process.env.NODE_ENV === "production" && !explicitDir) return "none";
  const disabled = (process.env.BLOB_LOCAL_DISABLE ?? "").trim().toLowerCase();
  if (disabled && disabled !== "0" && disabled !== "false") return "none";
  return "local";
}
