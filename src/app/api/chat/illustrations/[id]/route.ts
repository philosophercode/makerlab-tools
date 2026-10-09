import { NextRequest } from "next/server";
import { resolveIdentity } from "../../../../../lib/auth/identity";
import { getBlobStore, isBlobConfigured } from "../../../../../lib/blob";
import { findReadyIllustration } from "../../../../../lib/data/chat-illustrations";
import { checkRateLimit } from "../../../../../lib/rate-limit";

/**
 * `GET /api/chat/illustrations/[id]` — a chat illustration's picture (gateway
 * spec amendment 2026-10-07 "Generated illustrations in the chat").
 *
 * An illustration is stored **private**: it was made from one person's plan or
 * project idea, it is nobody else's, and it must never be mistaken for, or
 * reused as, a picture of the lab's equipment. So the chat cannot load it
 * from Blob directly, and this route serves it — to the person who asked for
 * it, and to nobody else, staff included.
 *
 * - **Gate first.** Identity, then the `illustrations` limiter, before a row is
 *   read: 401 to an anonymous caller.
 * - **Only your own, only once made.** Another person's id, a pending or failed
 *   one, a malformed id, or no Blob store is a 404 — the same answer, so an id
 *   cannot be probed for whether it exists.
 * - **Never cached** by anything shared: `private, no-store`, like the
 *   review page's cleaned image.
 */

// `runtime` cannot be set when nextConfig.cacheComponents is enabled.
export const maxDuration = 15;

const notFound = () => Response.json({ code: "not_found", error: "No such image." }, { status: 404 });

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const identity = await resolveIdentity(req);

  const rate = await checkRateLimit("illustrations", identity);
  if (!rate.allowed) {
    return Response.json(
      { code: "rate_limited", error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
    );
  }
  if (!identity.userId) {
    return Response.json({ code: "sign_in_required", error: "Sign in to see your illustrations." }, { status: 401 });
  }
  if (!isBlobConfigured()) return notFound();

  const { id } = await params;
  try {
    const illustration = await findReadyIllustration(id, identity.userId);
    if (!illustration) return notFound();

    const blob = await getBlobStore().read(illustration.blobPathname, "private");
    if (!blob) return notFound();

    const body = blob.body instanceof Uint8Array ? Buffer.from(blob.body) : blob.body;
    return new Response(body, {
      status: 200,
      headers: {
        // Recorded from the image's own bytes when it was stored: PNG, JPEG or WebP.
        "Content-Type": illustration.contentType ?? "image/png",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error(`[illustration] serving ${id} failed`, err);
    return Response.json({ code: "failed", error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
