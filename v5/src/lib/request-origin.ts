/**
 * The origin a request was made to, from its headers — for showing absolute
 * URLs of this deployment on a page (the `/mcp` page's addresses). Behind
 * Vercel's proxy the host arrives as `x-forwarded-host` and the scheme as
 * `x-forwarded-proto`; locally only `host` is set, and a loopback host is http.
 *
 * Returns null when the request names no usable host, so the caller can fall
 * back to the configured base URL. Display only: nothing is authorised from it.
 */

const HOST = /^([a-z0-9.-]+|\[[0-9a-f:]+\])(:\d{1,5})?$/i;
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;

export function requestOrigin(headers: { get(name: string): string | null }): string | null {
  const host = firstValue(headers.get("x-forwarded-host")) ?? firstValue(headers.get("host"));
  if (!host || !HOST.test(host)) return null;
  const forwardedProto = firstValue(headers.get("x-forwarded-proto"));
  const proto =
    forwardedProto === "http" || forwardedProto === "https" ? forwardedProto : LOOPBACK.test(host) ? "http" : "https";
  return `${proto}://${host.toLowerCase()}`;
}

function firstValue(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim();
  return first ? first : null;
}
