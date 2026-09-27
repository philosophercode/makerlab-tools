import { NextRequest } from "next/server";
import { z } from "zod";
import { decideActionProposals } from "../../../lib/actions/proposals";
import { resolveIdentity } from "../../../lib/auth/identity";
import { getActionProposals, listChatActionProposals, type ActionProposalRecord } from "../../../lib/data/action-proposals";
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
 * `GET ?ids=a,b` re-reads this person's proposals by id — what a card does
 * when it mounts, so a reloaded or re-rendered card shows Confirmed,
 * Dismissed or Expired instead of offering Confirm again (§5.5). `GET
 * ?chatId=` lists them for a whole chat. Either way only the caller's own
 * rows are answered; another person's id is simply absent.
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
  const userId = identity.userId;
  const params = req.nextUrl.searchParams;

  const idsParam = params.get("ids");
  if (idsParam !== null) {
    const ids = idsParam.split(",").map((id) => id.trim());
    if (ids.length === 0 || ids.length > 20 || !ids.every(isUuid)) return refuse(400, "invalid_query", "Send ?ids= with 1–20 proposal ids.");
    const rows = (await getActionProposals(ids)).filter((row) => row.createdBy === userId);
    return Response.json({ proposals: rows.map(describe) }, { status: 200 });
  }

  const chatId = params.get("chatId")?.trim() ?? "";
  if (!chatId || chatId.length > 200) return refuse(400, "invalid_query", "Send ?ids= or ?chatId=.");
  const rows = await listChatActionProposals(chatId, userId);
  return Response.json({ proposals: rows.map(describe) }, { status: 200 });
}

/** One row as a card reads it: its state (expired by the database's clock) and what it stored. */
function describe(row: ActionProposalRecord) {
  return {
    id: row.id,
    groupId: row.groupId,
    actionId: row.actionId,
    status: row.expired ? "expired" : row.status,
    preview: row.preview,
    result: row.result,
    expiresAt: row.expiresAt.toISOString(),
  };
}
