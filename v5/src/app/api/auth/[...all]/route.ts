import { getAuth } from "../../../../lib/auth/config";
import { anonymousIdentity } from "../../../../lib/auth/identity";
import { checkRateLimit } from "../../../../lib/rate-limit";

/**
 * `GET|POST /api/auth/*` — the Better Auth handler (auth design spec §3.1).
 *
 * The route decides nothing. It rate-limits, then hands the request to the
 * configured instance; the domain check, the session cookie, and the
 * rejected-domain redirect all live in `lib/auth/config.ts`.
 *
 * When sign-in is not configured the endpoint answers 503 rather than throwing,
 * so a deployment without Google credentials still serves the catalog and the
 * assistant — sign-in unlocks, it does not gate the front door.
 */

// `runtime` cannot be set when nextConfig.cacheComponents is enabled.
// Default Node.js runtime is used.
export const maxDuration = 15;

async function handle(req: Request): Promise<Response> {
  // Always by IP: the whole point of these endpoints is that the caller has no
  // session yet (Article 4 — limit inbound before any outbound to Google).
  const identity = await anonymousIdentity(req);
  const { allowed, retryAfterSeconds } = await checkRateLimit("auth", identity);
  if (!allowed) {
    return Response.json(
      { error: "Too many requests. Please slow down." },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfterSeconds) },
      }
    );
  }

  const auth = getAuth();
  if (!auth) {
    return Response.json({ error: "Sign-in is not configured." }, { status: 503 });
  }

  return auth.handler(req);
}

export const GET = handle;
export const POST = handle;
