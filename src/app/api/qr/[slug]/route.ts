import { hashIp } from "../../../../lib/auth/identity";
import { getCatalogTool } from "../../../../lib/catalog";
import { getClientIp, rateLimitAsync, ROUTE_TIERS } from "../../../../lib/rate-limit";
import { qrSvg } from "../../../../lib/qr/matrix";
import { qrPng } from "../../../../lib/qr/png";
import { qrSiteUrl } from "../../../../lib/qr/site-url";
import { parseQrQuery } from "../../../../lib/qr/query";
import { qrFileName, toolQrTargetUrl } from "../../../../lib/qr/urls";

// `runtime` cannot be set when nextConfig.cacheComponents is enabled.

/**
 * `GET /api/qr/<slug>?format=svg|png&size=<px>&download=1` — a published
 * tool's QR code as an image (QR labels). The tool page's QR dialog and the
 * assistant's `get_tool_qr_code` card load it; the admin sheets draw their
 * own codes from the same `lib/qr` modules.
 *
 * - **Public, and only for published tools.** The code encodes the tool's
 *   public page (`toolQrTargetUrl`, the `?src=qr` format every label uses),
 *   so it reveals nothing the catalogue does not. `getCatalogTool` is the
 *   published-only cached read, so a draft, an archived tool or an unknown
 *   slug is the same **404** — no answer confirms a draft exists.
 * - **No cookie is read** (like `/api/kiosk`): the limiter is keyed by the
 *   hashed client address and runs before the catalogue read.
 * - **Cached.** A code changes only if the tool's slug does, so an hour in the
 *   browser and a day at the CDN, revalidated in the background.
 * - `format` defaults to `svg`; `size` (PNG only) is 128–2048 px, default 512;
 *   anything else is **400**. `download=1` answers as an attachment named
 *   `<slug>-qr.<ext>`.
 */

const CACHE = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";

function refusal(error: string, status: number, headers: Record<string, string> = {}): Response {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const key = `qr:ip:${await hashIp(getClientIp(req))}`;
  const { allowed } = await rateLimitAsync(key, ROUTE_TIERS.qr);
  if (!allowed) return refusal("rate_limited", 429, { "Retry-After": "60" });

  const query = parseQrQuery(new URL(req.url).searchParams);
  if ("error" in query) return refusal(query.error, 400);

  const { slug } = await params;
  let tool: Awaited<ReturnType<typeof getCatalogTool>>;
  try {
    tool = await getCatalogTool(slug);
  } catch (err) {
    console.error("[qr] catalogue unavailable", err);
    return refusal("unavailable", 503);
  }
  if (!tool) return refusal("not_found", 404);

  const target = toolQrTargetUrl(qrSiteUrl(), tool.slug);
  const disposition = `${query.download ? "attachment" : "inline"}; filename="${qrFileName(tool.slug, query.format)}"`;
  const headers = {
    "Cache-Control": CACHE,
    "Content-Disposition": disposition,
    "X-Content-Type-Options": "nosniff",
  };

  if (query.format === "png") {
    const png = await qrPng(target, query.size);
    return new Response(new Uint8Array(png), { headers: { ...headers, "Content-Type": "image/png" } });
  }
  const svg = qrSvg(target, { title: `QR code: ${tool.name}` });
  return new Response(svg, {
    headers: {
      ...headers,
      "Content-Type": "image/svg+xml; charset=utf-8",
      // Our own markup, no script; opened directly it may still run nothing.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}
