import { NextRequest } from "next/server";
import {
  parseCorrectionReport,
  submitCorrection,
  type FlagErrorCode,
} from "../../../lib/capabilities/flags";
import { rateLimitAsync } from "../../../lib/rate-limit";
import { resolveIdentity } from "../../../lib/auth/identity";

/**
 * `POST /api/flags` — the form path for "report a correction" (design spec
 * 2026-07-29 §3, §9.2). It owns nothing: validation and the Notion write both
 * live in the `flags` capability, so this route and the assistant's
 * `report_correction` tool share one code path (constitution Art. 2).
 *
 * Responses carry a machine-readable `code` rather than a prose message —
 * `FlagButton` translates it, so no English-only string is ever shown to a
 * student (Art. 6).
 */

// `runtime` cannot be set when nextConfig.cacheComponents is enabled.
// Default Node.js runtime is used.
export const maxDuration = 15;

/** 5 per hour per IP — tighter than chat, looser than project submission (§8). */
const RATE_LIMIT = { limit: 5, windowMs: 60 * 60_000 };

const STATUS_BY_CODE: Record<FlagErrorCode, number> = {
  invalid_input: 400,
  unknown_tool: 404,
  not_configured: 503,
  write_failed: 502,
};

function fail(code: FlagErrorCode) {
  return Response.json({ code }, { status: STATUS_BY_CODE[code] });
}

export async function POST(req: NextRequest) {
  // Rate limit before any catalog read or Notion write (Art. 4). Keyed on the
  // resolved identity — user id when signed in, hashed IP when not.
  const identity = await resolveIdentity(req);
  const { allowed } = await rateLimitAsync(
    `flags:${identity.rateLimitKey}`,
    RATE_LIMIT
  );
  if (!allowed) {
    return Response.json(
      { code: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(RATE_LIMIT.windowMs / 1000) } }
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return fail("invalid_input");
  }

  const parsed = parseCorrectionReport(payload);
  if (!parsed.ok) return fail(parsed.code);

  // `reporter_email` is only ever written from the server-resolved session
  // above — a client may not assert its own identity. Anonymous reporting stays
  // the intended default (§8): an unauthenticated caller simply has no email,
  // and the report is filed without one.
  const result = await submitCorrection(
    parsed.report,
    identity.email
      ? { name: identity.name ?? undefined, email: identity.email }
      : undefined
  );
  if (!result.ok) return fail(result.code);

  return Response.json({ id: result.id }, { status: 201 });
}
