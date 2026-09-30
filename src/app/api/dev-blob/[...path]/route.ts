import { createLocalBlobBackend } from "../../../../lib/blob-local";
import { blobMode } from "../../../../lib/blob-mode";

/**
 * `GET /api/dev-blob/<pathname>` — the local Blob store's public URL.
 *
 * In local development with no `BLOB_READ_WRITE_TOKEN`, uploads, promoted
 * photos, archived manuals and backups are written to `.blob-data/`
 * (`lib/blob-local.ts`), and a public file's URL points here. This serves it
 * with the content type it was stored with, as a public Vercel Blob URL would.
 *
 * - **Inert outside local mode.** On Vercel, in a production build, with a
 *   real token, or with `BLOB_LOCAL_DISABLE=1`, every request is a 404 — the
 *   route exists in production and does nothing there.
 * - **Private files are 404**, exactly as a private blob URL is unreachable
 *   without the token. Code that needs a private file's bytes reads them
 *   through the store, not a URL.
 * - **No path traversal.** The pathname is validated before it touches the
 *   disk (`resolveLocalPath`); anything that could leave the folder or reach
 *   its metadata is a 404.
 */

// `runtime` cannot be set when nextConfig.cacheComponents is enabled.
// Default Node.js runtime is used.

const notFound = () => new Response("Not found", { status: 404 });

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  if (blobMode() !== "local") return notFound();

  const { path } = await params;
  if (!Array.isArray(path) || path.length === 0) return notFound();

  let blob: Awaited<ReturnType<ReturnType<typeof createLocalBlobBackend>["read"]>>;
  try {
    blob = await createLocalBlobBackend().read(path.join("/"));
  } catch {
    return notFound();
  }
  if (!blob || blob.meta.access !== "public") return notFound();

  return new Response(Buffer.from(blob.body), {
    status: 200,
    headers: {
      "Content-Type": blob.meta.contentType,
      "Content-Length": String(blob.body.byteLength),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
