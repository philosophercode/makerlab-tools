import { NextRequest } from "next/server";
import { resolveIdentity } from "../../../../../lib/auth/identity";
import { can } from "../../../../../lib/auth/permissions";
import { getBlobStore, isBlobConfigured } from "../../../../../lib/blob";
import { findAttachmentsByIds } from "../../../../../lib/data/attachments";
import { getPendingTool } from "../../../../../lib/data/pending-tools";
import { INTAKE_REVIEW_PERMISSION } from "../../../../../lib/intake/access";
import type { PendingApiError, PendingApiErrorCode } from "../../../../../lib/intake/types";
import { checkRateLimit } from "../../../../../lib/rate-limit";

/**
 * `GET /api/pending-tools/[id]/cleaned-image` — the background-removed copy
 * research made of an item's rank-1 product image (gateway spec §3.5, §6).
 *
 * That copy is the one file research stores before anybody decides anything,
 * and it is stored **private**: it is a cutout of a photograph somebody else
 * published (the backdrop made transparent, the pixels otherwise theirs), and
 * it is nobody's until an admin chooses it. The review page
 * still has to show it beside its original, and a browser cannot load a
 * private blob — so this route serves it, to the people who review intake and
 * to nobody else.
 *
 * - **Gate first.** Identity, then the `pendingTools` limiter, then
 *   `tools.approve` (`INTAKE_REVIEW_PERMISSION`), before a row is read: 401 to
 *   an anonymous caller, 403 to a signed-in one who may not review.
 * - **Only this file.** The attachment is the one `research.images.cleaned`
 *   names, and it must still be owned by *this* pending item with `origin`
 *   `research_image_cleaned`. Anything else — no such item, no cleaned copy, a
 *   row that has moved on (released, or approved onto a tool), or no Blob
 *   store — is a 404. The id in the URL can never reach any other attachment.
 * - **Never cached.** `private, no-store`: the bytes are behind a permission,
 *   and a released copy must stop being served the moment it is released.
 */

// `runtime` cannot be set when nextConfig.cacheComponents is enabled.
// Default Node.js runtime is used.
export const maxDuration = 15;

function refusal(code: PendingApiErrorCode, error: string, status: number): Response {
  return Response.json({ code, error } satisfies PendingApiError, { status });
}

const notFound = () => refusal("not_found", "No such image.", 404);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const identity = await resolveIdentity(req);

  // Rate-limited before any row or blob is touched (Article 4).
  const rate = await checkRateLimit("pendingTools", identity);
  if (!rate.allowed) {
    return Response.json(
      { code: "rate_limited", error: "Too many requests. Please slow down." } satisfies PendingApiError,
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
    );
  }
  if (identity.role === "anonymous") {
    return refusal("sign_in_required", "Sign in to review pending equipment.", 401);
  }
  if (!can(identity, INTAKE_REVIEW_PERMISSION)) {
    return refusal("forbidden", "Your account cannot review pending equipment.", 403);
  }

  if (!isBlobConfigured()) return notFound();

  const { id } = await params;
  try {
    // Null for a missing row and for anything that is not uuid-shaped alike.
    const item = await getPendingTool(id);
    const cleaned = item?.research?.images?.cleaned ?? null;
    if (!item || !cleaned) return notFound();

    const [row] = await findAttachmentsByIds([cleaned.attachmentId]);
    if (
      !row ||
      row.ownerType !== "pending_tool" ||
      row.ownerId !== item.id ||
      row.origin !== "research_image_cleaned"
    ) {
      return notFound();
    }

    // Private until an approval promotes it; an approval that promoted it and
    // was then refused leaves it public but still the item's.
    const blob = await getBlobStore().read(row.blobPathname, row.access === "public" ? "public" : "private");
    if (!blob) return notFound();

    const body = blob.body instanceof Uint8Array ? Buffer.from(blob.body) : blob.body;
    return new Response(body, {
      status: 200,
      headers: {
        // Always a PNG: research keeps a cleaned copy only if it decodes as one.
        "Content-Type": "image/png",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    // An id and a stack, nothing more.
    console.error(`[pending-tools] cleaned image for ${id} failed`, err);
    return refusal("failed", "Something went wrong. Please try again.", 500);
  }
}
