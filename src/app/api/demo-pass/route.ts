import { authSecret, resolveIdentity } from "../../../lib/auth/identity";
import { findOrCreateDemoSignup } from "../../../lib/data/demo-signups";
import { DEMO_PASS_DAYS, demoPassBudgetUsd, demoPassContactEmail, demoPassEnabled } from "../../../lib/demo-pass/config";
import { demoPassSetCookie, isHttpsRequest } from "../../../lib/demo-pass/cookie";
import { resolveDemoPass } from "../../../lib/demo-pass/resolve";
import { parseDemoSignup } from "../../../lib/demo-pass/signup";
import { demoPassState, toDemoPassView } from "../../../lib/demo-pass/state";
import { signDemoPass } from "../../../lib/demo-pass/token";
import { checkRateLimit, type RateLimitDecision } from "../../../lib/rate-limit";

/**
 * `/api/demo-pass` (demo pass spec 2026-10-07 §5.1, §5.3).
 *
 * - **`POST`** — sign up from `/demo`: store the sign-up (or find this
 *   address's) and set the pass cookie. In order: the limiter (60 an hour per
 *   hashed IP, before anything else), the body cap, the honeypot, validation,
 *   the secret, the write. One pass per email: signing up again answers
 *   `existing` with a fresh cookie for the same pass, and an expired pass is
 *   not renewed.
 * - **`GET`** — the caller's pass, for the chat's indicator: the money left
 *   and the end date, never the name or address. `{ active: false }` for no
 *   pass, and for a signed-in caller, whose session outranks any pass.
 *
 * Answers carry a `code`; the words a visitor reads come from the messages
 * (Article 6). Nothing here is cached anywhere (`no-store`).
 */

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** The largest body read: the form is a few short fields. */
const MAX_BODY_BYTES = 8_192;

const DAY_MS = 86_400_000;

export async function POST(req: Request): Promise<Response> {
  const identity = await resolveIdentity(req);
  const limit = await checkRateLimit("demoSignup", identity);
  if (!limit.allowed) return rateLimited(limit);

  if (!demoPassEnabled()) return Response.json({ ok: false, code: "closed" }, { status: 403, headers: NO_STORE });

  const text = await req.text().catch(() => "");
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return Response.json({ ok: false, code: "too_large" }, { status: 413, headers: NO_STORE });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ ok: false, code: "invalid", fields: {} }, { status: 400, headers: NO_STORE });
  }

  const parsed = parseDemoSignup(body);
  // A filled honeypot: thanked, and nothing stored, set or said about why.
  if (parsed.kind === "bot") return Response.json({ ok: true, status: "received", pass: null }, { headers: NO_STORE });
  if (parsed.kind === "invalid") {
    return Response.json({ ok: false, code: "invalid", fields: parsed.fields }, { status: 400, headers: NO_STORE });
  }

  // No secret, nothing can be signed: no pass can exist on this deployment.
  const secret = authSecret();
  if (!secret) return Response.json({ ok: false, code: "unavailable" }, { status: 503, headers: NO_STORE });

  const now = new Date();
  let created: boolean;
  let pass: Awaited<ReturnType<typeof findOrCreateDemoSignup>>["pass"];
  try {
    ({ created, pass } = await findOrCreateDemoSignup({ ...parsed.value, passExpiresAt: new Date(now.getTime() + DEMO_PASS_DAYS * DAY_MS) }));
  } catch (err) {
    // Never the error's message: Drizzle's lists the bound values, and they are a visitor's details.
    console.warn("[demo-pass] a sign-up could not be stored", err instanceof Error ? err.name : "error");
    return Response.json({ ok: false, code: "unavailable" }, { status: 503, headers: NO_STORE });
  }

  if (pass.passExpiresAt.getTime() <= now.getTime()) {
    return Response.json({ ok: true, status: "expired", pass: null }, { headers: NO_STORE });
  }

  const token = await signDemoPass({ passId: pass.id, expiresAt: pass.passExpiresAt }, secret);
  if (!token) return Response.json({ ok: false, code: "unavailable" }, { status: 503, headers: NO_STORE });

  return Response.json(
    {
      ok: true,
      status: created ? "created" : "existing",
      pass: toDemoPassView(demoPassState(pass, demoPassBudgetUsd()), demoPassContactEmail()),
    },
    {
      status: created ? 201 : 200,
      headers: { ...NO_STORE, "Set-Cookie": demoPassSetCookie(token, pass.passExpiresAt, { secure: isHttpsRequest(req.headers), now }) },
    }
  );
}

export async function GET(req: Request): Promise<Response> {
  const identity = await resolveIdentity(req);
  const limit = await checkRateLimit("demoPassStatus", identity);
  if (!limit.allowed) return rateLimited(limit);

  if (identity.role !== "anonymous") return Response.json({ active: false }, { headers: NO_STORE });
  const pass = await resolveDemoPass(req.headers);
  if (!pass) return Response.json({ active: false }, { headers: NO_STORE });
  return Response.json({ active: true, pass: toDemoPassView(pass, demoPassContactEmail()) }, { headers: NO_STORE });
}

function rateLimited(limit: RateLimitDecision): Response {
  return Response.json(
    { ok: false, code: "rate_limited", retryAfterSeconds: limit.retryAfterSeconds },
    { status: 429, headers: { ...NO_STORE, "Retry-After": String(limit.retryAfterSeconds) } }
  );
}
