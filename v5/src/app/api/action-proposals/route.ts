import { NextRequest } from "next/server";
import { z } from "zod";
import { decideActionProposals } from "../../../lib/actions/proposals";
import { resolveIdentity } from "../../../lib/auth/identity";
import { listChatActionProposals } from "../../../lib/data/action-proposals";
import { isUuid } from "../../../lib/data/uuid";
import { checkRateLimit } from "../../../lib/rate-limit";

/**
 * `/api/action-proposals` — **Confirm** and **Cancel** on the assistant's
 * action cards (assistant–GUI parity spec §3.5).
 *
 * The only way an assistant proposal commits, and it is the person's click:
 *
 * 1. Who is asking comes from the **session cookie only** — `resolveIdentity`
 *    never reads a bearer token here, so an MCP client can never confirm its
 *    own proposal (§8.2).
 * 2. The `actionConfirm` limiter, before anything is read.
 * 3. The body names ids and a decision, nothing else (`strictObject`): the
 *    input that runs is the row's stored input, so a client cannot change
 *    the change between card and commit.
 * 4. `decideActionProposals` touches only rows this person created, claims
 *    each once, and runs it through `performAction` — which checks the
 *    permission, the floor and the shared admin rate tier again, at the click.
 *
 * `GET ?chatId=` re-reads this person's proposals in one chat, so a card can
 * show its state after the stream dropped or the page reloaded (§5.5).
 */

export const maxDuration = 30;

const bodySchema = z.strictObject({
  ids: z.array(z.string().refine(isUuid)).min(1).max(20),
  decision: z.enum(["confirm", "cancel"]),
  typed: z.string().max(300).optional(),
});

function refuse(status: number, code: string, error: string, headers?: Record<string, string>): Response {
  return Response.json({ code, error }, { status, headers });
}

export async function POST(req: NextRequest) {
  const identity = await resolveIdentity(req);
  const limit = await checkRateLimit("actionConfirm", identity);
  if (!limit.allowed) {
    return refuse(429, "rate_limited", "Too many requests. Please slow down.", { "Retry-After": String(limit.retryAfterSeconds) });
  }
  if (identity.role === "anonymous" || !identity.userId) return refuse(401, "sign_in_required", "Sign in to confirm a change.");

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return refuse(400, "invalid_body", "The request body is not JSON.");
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return refuse(400, "invalid_body", 'Send { ids: [...], decision: "confirm" | "cancel" }.');

  try {
    const results = await decideActionProposals(parsed.data, identity);
    return Response.json({ results }, { status: 200 });
  } catch (error) {
    console.error("[action-proposals] decision failed", error);
    return refuse(500, "failed", "That did not save. Nothing was changed.");
  }
}

export async function GET(req: NextRequest) {
  const identity = await resolveIdentity(req);
  const limit = await checkRateLimit("actionConfirm", identity);
  if (!limit.allowed) {
    return refuse(429, "rate_limited", "Too many requests. Please slow down.", { "Retry-After": String(limit.retryAfterSeconds) });
  }
  if (identity.role === "anonymous" || !identity.userId) return refuse(401, "sign_in_required", "Sign in to see proposals.");
  const chatId = req.nextUrl.searchParams.get("chatId")?.trim() ?? "";
  if (!chatId || chatId.length > 200) return refuse(400, "invalid_query", "Send ?chatId=.");

  const rows = await listChatActionProposals(chatId, identity.userId);
  return Response.json(
    {
      proposals: rows.map((row) => ({
        id: row.id,
        groupId: row.groupId,
        actionId: row.actionId,
        status: row.expired ? "expired" : row.status,
        preview: row.preview,
        result: row.result,
        expiresAt: row.expiresAt.toISOString(),
      })),
    },
    { status: 200 }
  );
}
