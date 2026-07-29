import { resolveIdentity } from "../../../lib/auth/identity";
import { rateLimitAsync } from "../../../lib/rate-limit";

/**
 * `GET /api/identity` — who the server thinks the caller is (auth design spec
 * §5, §6).
 *
 * The header needs this because it renders inside a statically-shelled layout
 * and cannot read the session cookie during render. The route decides nothing:
 * it projects `resolveIdentity` down to the two fields a header can use.
 *
 * **Role and display name only.** The email stays server-side (§8) — the header
 * shows a first name, and nothing in the browser needs more than that.
 *
 * Anonymous is a normal answer, not an error, so this always responds 200 with
 * `role: "anonymous"` rather than 401.
 */

// `runtime` cannot be set when nextConfig.cacheComponents is enabled.
// Default Node.js runtime is used.

/**
 * Generous on purpose: this is one cheap HMAC verification per page load with
 * no outbound call behind it, and a header that renders "Sign in" to someone who
 * is signed in is worse than the traffic it would save. Still bounded, still
 * before any work (Article 4), and keyed per identity so one client cannot spend
 * another's allowance.
 */
const IDENTITY_TIER = { limit: 120, windowMs: 60_000 };

export async function GET(req: Request): Promise<Response> {
  const identity = await resolveIdentity(req);

  const { allowed } = await rateLimitAsync(
    `identity:${identity.rateLimitKey}`,
    IDENTITY_TIER
  );
  if (!allowed) {
    return Response.json(
      { error: "Too many requests. Please slow down." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(IDENTITY_TIER.windowMs / 1000)),
          "cache-control": "no-store",
        },
      }
    );
  }

  return Response.json(
    { role: identity.role, name: identity.name },
    {
      // Per-request and per-person: never cache it anywhere, ever.
      headers: { "cache-control": "no-store, private" },
    }
  );
}
