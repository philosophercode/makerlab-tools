import { getAuth } from "../../../../lib/auth/config";
import {
  defaultDevSignInEmail,
  devSignInAllowed,
  safeNextPath,
} from "../../../../lib/auth/dev-sign-in";
import { evaluateUser, hashIp } from "../../../../lib/auth/identity";
import { normalizeEmail } from "../../../../lib/auth/roles";
import { recordAuditEvent } from "../../../../lib/data/audit";
import { findUserById } from "../../../../lib/data/users";
import { getClientIp, rateLimitAsync, ROUTE_TIERS } from "../../../../lib/rate-limit";

/**
 * `GET /api/dev/sign-in?as=<email>&next=/admin` — development-only sign-in
 * (auth spec amendment 2026-09-24).
 *
 * Signs the person running `npm run dev` in as `as` (or
 * `DEV_AUTO_SIGN_IN_EMAIL`) with a real Better Auth database session, then
 * redirects to `next`. Creates the user if missing, with the role a first
 * Google sign-in would give — so `?as=student@cornell.edu` shows the student
 * experience and an address on `AUTH_SUPER_ADMIN_EMAILS` arrives a super admin.
 *
 * **Every refusal is a 404**, so the route is invisible wherever it is not
 * meant to exist: a production build, any Vercel deployment, the opt-in
 * `DEV_AUTO_SIGN_IN=1` unset, a request that did not come from this machine
 * directly (`lib/auth/dev-sign-in.ts`), an address that may not sign in, or a
 * banned one. `next` is a same-origin path or it is `/`.
 */

// `runtime` cannot be set when nextConfig.cacheComponents is enabled.
// Default Node.js runtime is used.

const notFound = () =>
  new Response("Not found", {
    status: 404,
    headers: { "cache-control": "no-store" },
  });

export async function GET(req: Request): Promise<Response> {
  // Guards 1–4, before anything else — including the limiter, so a refused
  // request leaves no trace a caller could probe for.
  if (!devSignInAllowed(req.headers)) return notFound();

  const { allowed } = await rateLimitAsync(
    `dev-sign-in:${await hashIp(getClientIp(req))}`,
    ROUTE_TIERS.auth
  );
  if (!allowed) {
    return new Response("Too many requests", {
      status: 429,
      headers: { "Retry-After": "60", "cache-control": "no-store" },
    });
  }

  const url = new URL(req.url);
  const email = normalizeEmail(url.searchParams.get("as")) || defaultDevSignInEmail();
  const next = safeNextPath(url.searchParams.get("next"));
  if (!email) {
    return new Response(
      "Pass ?as=<email>, or set DEV_AUTO_SIGN_IN_EMAIL in .env.local.",
      { status: 400, headers: { "cache-control": "no-store" } }
    );
  }

  const auth = await getAuth();
  // No AUTH_SECRET: no session can exist, so there is nothing to sign in to.
  if (!auth) return notFound();

  let result;
  try {
    result = await auth.api.devSignIn({
      body: { email },
      headers: forwardableHeaders(req.headers),
      returnHeaders: true,
    });
  } catch (err) {
    // Out of domain, banned, or the environment guards failing inside Better
    // Auth: all the same 404. The reason goes to the dev server's console,
    // which is the only place the person who asked will look.
    console.warn("[dev-sign-in] refused", email, describe(err));
    return notFound();
  }

  const { userId, created } = result.response;
  const stored = await findUserById(userId).catch(() => null);
  const verdict = stored ? evaluateUser(stored) : null;
  const role = verdict?.ok ? verdict.role : null;

  try {
    await recordAuditEvent({
      actorUserId: userId,
      action: "auth.dev_sign_in",
      subjectType: "user",
      subjectId: userId,
      detail: { created, role },
    });
  } catch (err) {
    // The session exists; refusing now would not undo it. Say so where the
    // developer is looking.
    console.error("[dev-sign-in] audit write failed after the session was created", err);
  }

  const headers = new Headers({ location: next, "cache-control": "no-store" });
  for (const cookie of result.headers.getSetCookie()) {
    headers.append("set-cookie", cookie);
  }
  return new Response(null, { status: 303, headers });
}

/** What Better Auth reads for the session row's user agent and IP. */
function forwardableHeaders(source: Headers): Headers {
  const copy = new Headers();
  for (const name of ["user-agent", "x-forwarded-for"]) {
    const value = source.get(name);
    if (value) copy.set(name, value);
  }
  return copy;
}

function describe(err: unknown): string {
  if (err && typeof err === "object") {
    const body = (err as { body?: { code?: string } }).body;
    if (body?.code) return body.code;
    if ("message" in err) return String((err as { message: unknown }).message);
  }
  return String(err);
}
