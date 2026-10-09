import { NextRequest } from "next/server";
import { resolveIdentity } from "../../../lib/auth/identity";
import { can } from "../../../lib/auth/permissions";
import { listPendingTools } from "../../../lib/data/pending-tools";
import { isUuid } from "../../../lib/data/uuid";
import { canActOnPendingTool } from "../../../lib/intake/access";
import { RESEARCH_MAX_ITEMS_PER_REQUEST } from "../../../lib/intake/limits";
import type { PendingApiError, PendingToolView } from "../../../lib/intake/types";
import { toPendingToolView } from "../../../lib/intake/view";
import { checkRateLimit } from "../../../lib/rate-limit";

/**
 * `GET /api/pending-tools?ids=<id>,<id>…` — the chat's intake card reading its
 * own rows again (data platform spec amendment "A photo for a name"): while a
 * photo is being looked up for an item named without one, the card asks every
 * few seconds, in **one** request for all of its rows, until each lookup has
 * landed or gone stale. A read only — every change is the `[id]` route's PATCH.
 *
 * - **Gate first**: identity, the `pendingTools` limiter, `tools.add`; 401
 *   anonymous, 403 without it. Then only the rows the caller may work
 *   (`canActOnPendingTool` — their own, or anyone's with `tools.approve`) are
 *   answered; an id that is not uuid-shaped, missing or not theirs is left
 *   out, so nobody learns which ids exist.
 * - **At most {@link RESEARCH_MAX_ITEMS_PER_REQUEST} ids** — a card's rows
 *   (`IDENTIFY_MAX_ITEMS` is 25 too); more is `invalid_body`.
 * - **Never cached**: the answer is the rows as they are now.
 */

// `runtime` cannot be set when nextConfig.cacheComponents is enabled.
// Default Node.js runtime is used.
export const maxDuration = 15;

export interface PendingToolsListResponse {
  items: PendingToolView[];
}

function refusal(code: PendingApiError["code"], error: string, status: number): Response {
  return Response.json({ code, error } satisfies PendingApiError, { status });
}

export async function GET(req: NextRequest): Promise<Response> {
  const identity = await resolveIdentity(req);
  const rate = await checkRateLimit("pendingTools", identity);
  if (!rate.allowed) {
    return Response.json(
      { code: "rate_limited", error: "Too many requests. Please slow down." } satisfies PendingApiError,
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
    );
  }
  if (identity.role === "anonymous") return refusal("sign_in_required", "Sign in to see pending equipment.", 401);
  if (!can(identity, "tools.add")) return refusal("forbidden", "Your account cannot see pending equipment.", 403);

  const raw = (req.nextUrl.searchParams.get("ids") ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  if (raw.length === 0 || raw.length > RESEARCH_MAX_ITEMS_PER_REQUEST) {
    return refusal("invalid_body", `Name between 1 and ${RESEARCH_MAX_ITEMS_PER_REQUEST} items.`, 400);
  }
  const ids = [...new Set(raw.filter(isUuid))];
  try {
    const rows = ids.length > 0 ? await listPendingTools({ ids }) : [];
    const items = rows.filter((row) => canActOnPendingTool(identity, row)).map(toPendingToolView);
    return Response.json({ items } satisfies PendingToolsListResponse, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    console.error("[pending-tools] GET list failed", err);
    return refusal("failed", "Something went wrong. Please try again.", 500);
  }
}
