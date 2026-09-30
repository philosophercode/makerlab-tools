import { normalizeEmail } from "./roles";

/**
 * Development-only automatic sign-in: the guards (auth spec amendment
 * 2026-09-24, "Development-only sign-in").
 *
 * `GET /api/dev/sign-in?as=<email>&next=/admin` gives the person running
 * `npm run dev` a real Better Auth database session without the Google round
 * trip. It is a way to *be* somebody, so every guard below is required, each
 * one on its own is enough to refuse, and a refusal is a **404** — the route is
 * invisible, not forbidden, wherever it is not meant to exist.
 *
 * 1. `NODE_ENV === "development"` — `next dev`, never a build. `next build`
 *    and `next start` run with `production`; Vitest runs with `test`.
 * 2. `VERCEL` unset — no Vercel deployment, preview or production, ever.
 * 3. `DEV_AUTO_SIGN_IN=1` — an explicit opt-in, so a fresh clone does not
 *    have it.
 * 4. A loopback request — the `Host` is `localhost` / `127.0.0.1` / `[::1]`
 *    (any port), and any forwarding header names only loopback too. A tunnel
 *    to the dev server (ngrok, Cloudflare) carries its own host, or the
 *    visitor's address in `X-Forwarded-For`, and is refused.
 *
 * The fifth guard — the address may sign in at all (domain, allowlist, ban) —
 * is not here: it is Better Auth's own create hook and the admin plugin's ban
 * check, run by the endpoint in `dev-sign-in-plugin.ts`, so it cannot drift
 * from what Google sign-in enforces.
 *
 * Every read is at call time, so tests can `vi.stubEnv` without resetting
 * modules.
 */

/**
 * Guards 1–3: the environment allows the feature at all. Also what the Better
 * Auth endpoint re-checks, so the endpoint refuses even if something other than
 * the route ever called it.
 */
export function devSignInEnvEnabled(): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  if (process.env.VERCEL) return false;
  return process.env.DEV_AUTO_SIGN_IN === "1";
}

/** Guard 4: the request reached the dev server from this machine, directly. */
export function isLoopbackRequest(headers: Pick<Headers, "get">): boolean {
  const host = headers.get("host");
  if (!host || !isLoopbackHost(host)) return false;

  const forwardedHost = headers.get("x-forwarded-host");
  if (forwardedHost && !forwardedHost.split(",").every((h) => isLoopbackHost(h))) {
    return false;
  }

  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor && !forwardedFor.split(",").every((ip) => isLoopbackAddress(ip))) {
    return false;
  }

  for (const header of ["x-real-ip", "cf-connecting-ip", "true-client-ip"]) {
    const value = headers.get(header);
    if (value && !isLoopbackAddress(value)) return false;
  }

  // RFC 7239 `Forwarded`: a proxy set it, so this is not a direct request.
  if (headers.get("forwarded")) return false;

  return true;
}

/** All four guards for one request. */
export function devSignInAllowed(headers: Pick<Headers, "get">): boolean {
  return devSignInEnvEnabled() && isLoopbackRequest(headers);
}

/** `DEV_AUTO_SIGN_IN_EMAIL`, normalized, or "" when unset. */
export function defaultDevSignInEmail(): string {
  return normalizeEmail(process.env.DEV_AUTO_SIGN_IN_EMAIL);
}

/**
 * The redirect target, if it is a same-origin relative path; `/` otherwise.
 *
 * Only a single leading `/` followed by something that is not another `/` or a
 * `\` passes: `//evil.com` and `/\evil.com` are protocol-relative to a browser,
 * and anything with a scheme is absolute. The parse against a throwaway origin
 * is the final word — if it lands anywhere but that origin, it is refused.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (typeof next !== "string" || next.length === 0) return "/";
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  // Control characters (tab, newline) are stripped by URL parsers and could
  // turn `/\t/evil.com` into `//evil.com`.
  for (let i = 0; i < next.length; i += 1) {
    const code = next.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return "/";
  }
  try {
    const base = "http://dev-sign-in.invalid";
    const url = new URL(next, base);
    if (url.origin !== base) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

function isLoopbackHost(value: string): boolean {
  const host = value.trim().toLowerCase();
  if (!host) return false;
  // `[::1]:3000`, `[::1]`
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    if (end < 0) return false;
    const rest = host.slice(end + 1);
    if (rest && !/^:\d+$/.test(rest)) return false;
    return host.slice(1, end) === "::1";
  }
  const [name, port, ...extra] = host.split(":");
  if (extra.length > 0) return false;
  if (port !== undefined && !/^\d+$/.test(port)) return false;
  return name === "localhost" || name === "127.0.0.1";
}

function isLoopbackAddress(value: string): boolean {
  const ip = value.trim().toLowerCase();
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}
