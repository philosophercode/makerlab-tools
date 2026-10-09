import { NextRequest } from "next/server";
import { resolveIdentity } from "../../../../../lib/auth/identity";
import { can } from "../../../../../lib/auth/permissions";
import { getBlobStore, isBlobConfigured } from "../../../../../lib/blob";
import { findAttachmentsByIds } from "../../../../../lib/data/attachments";
import { getPendingTool } from "../../../../../lib/data/pending-tools";
import { canActOnPendingTool } from "../../../../../lib/intake/access";
import type { PendingApiError, PendingApiErrorCode } from "../../../../../lib/intake/types";
import { checkRateLimit } from "../../../../../lib/rate-limit";

/**
 * `GET /api/pending-tools/[id]/found-photo` — the background-removed copy of
 * the photo looked up for an item named without one (data platform spec
 * amendment "A photo for a name").
 *
 * Like research's cleaned copy (`../cleaned-image`), it is a cutout of a
 * photograph somebody else published, stored **private** and nobody's until
 * an approval, so a browser cannot load it directly. This serves it to the
 * people who may work the item — its creator, or anyone holding
 * `tools.approve` (`canActOnPendingTool`, the intake table's own gate) — and
 * to nobody else.
 *
 * - **Gate first.** Identity, the `pendingTools` limiter, `tools.add`, then the
 *   item and `canActOnPendingTool`: 401 anonymous, 403 otherwise refused.
 * - **Only this file.** The attachment is the one `found_photo.cleaned` names,
 *   still owned by *this* item with `origin` `research_image_cleaned`.
 *   Anything else — no such item, no cleaned copy, a copy released (by
 *   approval or discard) or no Blob store — is a 404.
 * - **Never cached.** `private, no-store`.
 */

// `runtime` cannot be set when nextConfig.cacheComponents is enabled.
// Default Node.js runtime is used.
export const maxDuration = 15;

function refusal(code: PendingApiErrorCode, error: string, status: number): Response {
  return Response.json({ code, error } satisfies PendingApiError, { status });
}

const notFound = () => refusal("not_found", "No such image.", 404);

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const identity = await resolveIdentity(req);

  // Rate-limited before any row or blob is touched (Article 4).
  const rate = await checkRateLimit("pendingTools", identity);
  if (!rate.allowed) {
    return Response.json(
      { code: "rate_limited", error: "Too many requests. Please slow down." } satisfies PendingApiError,
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
    );
  }
  if (identity.role === "anonymous") return refusal("sign_in_required", "Sign in to see pending equipment.", 401);
  if (!can(identity, "tools.add")) return refusal("forbidden", "Your account cannot see pending equipment.", 403);
  if (!isBlobConfigured()) return notFound();

  const { id } = await params;
  try {
    const item = await getPendingTool(id);
    if (!item) return notFound();
    if (!canActOnPendingTool(identity, item)) return refusal("forbidden", "Your account cannot see this item.", 403);
    const cleaned = item.foundPhoto?.cleaned ?? null;
    if (!cleaned) return notFound();

    const [row] = await findAttachmentsByIds([cleaned.attachmentId]);
    if (!row || row.ownerType !== "pending_tool" || row.ownerId !== item.id || row.origin !== "research_image_cleaned") {
      return notFound();
    }
    const blob = await getBlobStore().read(row.blobPathname, row.access === "public" ? "public" : "private");
    if (!blob) return notFound();

    const body = blob.body instanceof Uint8Array ? Buffer.from(blob.body) : blob.body;
    return new Response(body, {
      status: 200,
      headers: {
        // Always a PNG: a cleaned copy is kept only if it encodes as one.
        "Content-Type": "image/png",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    // An id and a stack, nothing more.
    console.error(`[pending-tools] found photo for ${id} failed`, err);
    return refusal("failed", "Something went wrong. Please try again.", 500);
  }
}
