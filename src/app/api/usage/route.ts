import { resolveIdentity } from "../../../lib/auth/identity";
import { checkRateLimit } from "../../../lib/rate-limit";
import { beaconEvent, declinesTracking } from "../../../lib/usage/beacon";
import { audienceFor } from "../../../lib/usage/events";
import { recordUsage, usageEnabled } from "../../../lib/usage/record";

// `runtime` cannot be set when nextConfig.cacheComponents is enabled.

/**
 * `POST /api/usage` — Usage Insight's page-view beacon (usage insight spec
 * §5.3). Tool pages are cached, so the server never sees a view; the
 * `UsageBeacon` island posts `{ kind, toolId?, source }` once per tool per tab.
 *
 * In order: the `usage` tier (60/min, keyed on the caller's rate-limit key,
 * used for the check and never stored) → nothing recorded for `Sec-GPC`,
 * `DNT`, a bot, or `USAGE_INSIGHT=off` → the body must name a published tool
 * (`lib/usage/beacon.ts`) → one event, carrying the role's audience bucket
 * and nothing else about the visitor.
 *
 * **Always 204** (429 past the tier), whatever was recorded, so the answer
 * tells a client nothing — and a failed insert is a warning, never an error.
 */
export async function POST(req: Request) {
  const identity = await resolveIdentity(req);
  const decision = await checkRateLimit("usage", identity);
  if (!decision.allowed) {
    return new Response(null, { status: 429, headers: { "Retry-After": String(decision.retryAfterSeconds) } });
  }
  if (!usageEnabled() || declinesTracking(req.headers)) return noContent();

  try {
    const body: unknown = await req.json().catch(() => null);
    const event = await beaconEvent(body, audienceFor(identity.role));
    if (event) await recordUsage([event]);
  } catch (err) {
    console.warn("[usage] beacon not recorded", err instanceof Error ? err.message : err);
  }
  return noContent();
}

function noContent(): Response {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
