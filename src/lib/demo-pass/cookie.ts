import { requestOrigin } from "../request-origin";

/**
 * Reading and setting the demo pass cookie (demo pass spec 2026-10-07 §5.2).
 *
 * httpOnly, so no script on the page can read or copy it; `SameSite=Lax`, so it
 * travels on a visitor's own navigation and the chat's same-origin requests
 * but not on another site's form post; `Path=/`; `Secure` whenever the request
 * came over https, which is every deployment (local `next dev` on
 * http://localhost is the one place it is not, so Safari keeps the cookie
 * there too). Its lifetime is the seconds left until the pass ends.
 */

export const DEMO_PASS_COOKIE = "makerlab.demo_pass";

/** The cookie's value in a request's `Cookie` header, or null. */
export function readDemoPassCookie(headers: { get(name: string): string | null }): string | null {
  const header = headers.get("cookie");
  if (!header) return null;
  for (const pair of header.split(";")) {
    const at = pair.indexOf("=");
    if (at < 0) continue;
    if (pair.slice(0, at).trim() !== DEMO_PASS_COOKIE) continue;
    const value = pair.slice(at + 1).trim();
    return value || null;
  }
  return null;
}

/** True when the request reached us over https (directly, or through Vercel's proxy). */
export function isHttpsRequest(headers: { get(name: string): string | null }): boolean {
  return (requestOrigin(headers) ?? "").startsWith("https://");
}

/** The `Set-Cookie` value that stores `value` until `expiresAt`. */
export function demoPassSetCookie(value: string, expiresAt: Date, options: { secure: boolean; now?: Date }): string {
  const now = options.now ?? new Date();
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
  return [
    `${DEMO_PASS_COOKIE}=${value}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    `Expires=${expiresAt.toUTCString()}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(options.secure ? ["Secure"] : []),
  ].join("; ");
}
