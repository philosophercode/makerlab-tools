import { NextRequest } from "next/server";
import { resolveIdentity } from "../../../lib/auth/identity";
import { identityWithDemoPass } from "../../../lib/demo-pass/identity";
import { resolveDemoPass } from "../../../lib/demo-pass/resolve";
import { QUICK_REPORT_BODY_MAX } from "../../../lib/maintenance/quick-report-limits";
import { fileQuickReport, parseQuickReport, type QuickReportError } from "../../../lib/maintenance/quick-report";
import { checkRateLimit, type RateLimitDecision } from "../../../lib/rate-limit";

/**
 * `POST /api/report` — the quick report form (quick report spec §5): a
 * student's words about a machine become a normal maintenance ticket. A
 * public write, open to anonymous students like the chat's `report_issue`,
 * and filed through the same write (`lib/maintenance/file-ticket.ts`).
 *
 * In order, before anything costs a model call or a row:
 *
 * 1. The caller's identity, with the demo pass an anonymous visitor holds
 *    (demo pass spec 2026-10-07 §5.4, as the chat reads it), then the
 *    `quickReport` tier (eight an hour per person, pass or hashed IP).
 * 2. The body's size, its shape and the bot check (`parseQuickReport`).
 * 3. For a caller nobody is signed in as, one of the `anonTickets` slots
 *    shared with `report_issue`.
 * 4. The triage and the ticket (`fileQuickReport`).
 *
 * Answers carry a machine-readable `code`, which the form translates, and a
 * success carries only the ticket's short reference and the unit it landed on.
 */

// `runtime` cannot be set when nextConfig.cacheComponents is enabled.
// Default Node.js runtime is used.
export const maxDuration = 30;

type RouteCode = QuickReportError | "rate_limited";

const STATUS_BY_CODE: Record<RouteCode, number> = {
  invalid_input: 400,
  unknown_tool: 404,
  rate_limited: 429,
  write_failed: 502,
};

function fail(code: RouteCode, limit?: RateLimitDecision) {
  const headers: Record<string, string> = limit ? { "Retry-After": String(limit.retryAfterSeconds) } : {};
  return Response.json({ code }, { status: STATUS_BY_CODE[code], headers });
}

export async function POST(req: NextRequest) {
  // A demo pass is read beside the session, exactly as the chat does: a forged
  // cookie costs an HMAC, never a query, and only an anonymous caller's pass
  // counts. A pass holder's report is filed as a demo ticket.
  const [session, demoPass] = await Promise.all([resolveIdentity(req), resolveDemoPass(req.headers)]);
  const identity = identityWithDemoPass(session, demoPass);
  const limit = await checkRateLimit("quickReport", identity);
  if (!limit.allowed) return fail("rate_limited", limit);

  // The size first, from the header and then from what actually arrived.
  if (Number(req.headers.get("content-length") ?? 0) > QUICK_REPORT_BODY_MAX) return fail("invalid_input");
  let payload: unknown;
  try {
    const raw = await req.text();
    if (raw.length > QUICK_REPORT_BODY_MAX) return fail("invalid_input");
    payload = JSON.parse(raw);
  } catch {
    return fail("invalid_input");
  }

  const parsed = parseQuickReport(payload);
  if (!parsed.ok) return fail(parsed.code);

  // Anonymous reporting stays open, bounded the way the chat's is: this slot
  // is the same `anonTickets` budget `report_issue` spends.
  if (!identity.userId) {
    const anon = await checkRateLimit("anonTickets", identity);
    if (!anon.allowed) return fail("rate_limited", anon);
  }

  const filed = await fileQuickReport(parsed.report, identity);
  if (!filed.ok) return fail(filed.code);
  return Response.json(filed.value, { status: 201 });
}
