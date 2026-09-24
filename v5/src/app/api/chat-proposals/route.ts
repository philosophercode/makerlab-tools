import { NextRequest } from "next/server";
import { z } from "zod";
import { resolveIdentity } from "../../../lib/auth/identity";
import { can } from "../../../lib/auth/permissions";
import { isUuid } from "../../../lib/data/uuid";
import { checkRateLimit } from "../../../lib/rate-limit";
import { decideChatProposals } from "../../../lib/refresh/chat-decisions";

/**
 * `POST /api/chat-proposals` — **Accept** / **Reject** on the assistant's
 * proposal cards, and **Accept all verified** (refresh research spec §12.2).
 *
 * The admin's click, never a model tool: the chat has no tool that accepts,
 * and this route re-checks everything the card cannot vouch for — who is
 * asking (a signed-in admin: `tools.edit` for a tool, `tools.approve` for a
 * pending item), that each card is still open and not expired, and, when
 * writing, the record's revision (a stale one answers the card as a conflict,
 * with the record's value now). A route rather than a server action, like the
 * intake table card: `ChatFab` is a global client island.
 *
 * Body `{ ids: uuid[], decision: "accept" | "reject" }`; answers
 * `{ results: [{ id, status, proposal?, error?, warning? }] }`. Refusals
 * before any card is looked at are `{ code, error }` like the other routes.
 */

export const maxDuration = 30;

const bodySchema = z.strictObject({
  ids: z.array(z.string().refine(isUuid)).min(1).max(20),
  decision: z.enum(["accept", "reject"]),
});

function refuse(status: number, code: string, error: string, headers?: Record<string, string>): Response {
  return Response.json({ code, error }, { status, headers });
}

export async function POST(req: NextRequest) {
  const identity = await resolveIdentity(req);
  const decision = await checkRateLimit("pendingTools", identity);
  if (!decision.allowed) {
    return refuse(429, "rate_limited", "Too many requests. Please slow down.", { "Retry-After": String(decision.retryAfterSeconds) });
  }
  if (identity.role === "anonymous" || !identity.userId) return refuse(401, "sign_in_required", "Sign in to decide proposals.");
  const canEditTools = can(identity, "tools.edit");
  const canApprove = can(identity, "tools.approve");
  if (!canEditTools && !canApprove) return refuse(403, "forbidden", "Your account cannot curate records.");

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return refuse(400, "invalid_body", "The request body is not JSON.");
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return refuse(400, "invalid_body", 'Send { ids: [...], decision: "accept" | "reject" }.');

  try {
    const results = await decideChatProposals([...new Set(parsed.data.ids)], parsed.data.decision, {
      userId: identity.userId,
      canEditTools,
      canApprove,
      canPublish: can(identity, "tools.publish"),
    });
    return Response.json({ results }, { status: 200 });
  } catch (error) {
    console.error("[chat-proposals] decision failed", error);
    return refuse(500, "failed", "That did not save. Nothing was changed.");
  }
}
