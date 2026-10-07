import { hashIp } from "../../../lib/auth/identity";
import { loadKioskSnapshot, withAskUrl } from "../../../lib/kiosk/snapshot";
import { loadOnShiftNames } from "../../../lib/on-shift/read";
import type { KioskResponse } from "../../../lib/kiosk/types";
import { getClientIp, rateLimitAsync, ROUTE_TIERS } from "../../../lib/rate-limit";
import { authBaseUrl } from "../../../lib/auth/config";
import { requestOrigin } from "../../../lib/request-origin";

// `runtime` cannot be set when nextConfig.cacheComponents is enabled.

/**
 * `GET /api/kiosk` — the lab status screen's poll (kiosk spec §3.1, §5.2).
 *
 * Public, like `/` and `/tools/[id]`: it answers only what the anonymous
 * catalogue already shows, plus the open-ticket count the owner approved for
 * a public screen (Q1). **No cookie is read and none is set**, so the limiter
 * is keyed by the hashed client address alone, and it runs before the loader
 * (Article 4).
 *
 * - **200** — the snapshot, cached behind invalidation (`loadKioskSnapshot`),
 *   plus `servedAt` and who is on shift now (`onShift`, short names only).
 * - **429** — past `ROUTE_TIERS.kiosk`; the screen keeps what it has.
 * - **503** — the database could not be read. Never a zeroed snapshot: the
 *   screen keeps its last good one and says how old it is.
 */
export async function GET(req: Request) {
  const key = `kiosk:ip:${await hashIp(getClientIp(req))}`;
  const { allowed } = await rateLimitAsync(key, ROUTE_TIERS.kiosk);
  if (!allowed) {
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } }
    );
  }

  try {
    // Who is on shift is read beside the snapshot, never inside its cache (on-shift spec 2026-10-07).
    const [snapshot, onShift] = await Promise.all([loadKioskSnapshot(), loadOnShiftNames()]);
    const body: KioskResponse = {
      ...withAskUrl(snapshot, requestOrigin(req.headers) ?? authBaseUrl(), onShift),
      servedAt: new Date().toISOString(),
    };
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    // The driver's words stay in the log; the screen only needs to know.
    console.error("[kiosk] snapshot unavailable", err);
    return Response.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
