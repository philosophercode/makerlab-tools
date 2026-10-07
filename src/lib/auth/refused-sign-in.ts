import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Which Google address was just refused, and where to send the person if they
 * try another account (auth spec amendment 2026-10-07, "Choosing another
 * Google account").
 *
 * The refusal pages (`/auth/rejected`, `/auth/blocked`) used to say "that
 * account" without naming it. On a phone signed into a personal Gmail the
 * person often has no idea which account Google picked. So the moment the
 * create hook (or the after-hook) refuses an address, it leaves a short-lived
 * cookie naming it, and the page reads it back.
 *
 * - **A cookie, never the URL.** The address is personal data; a query string
 *   ends up in history, logs and referrers. The cookie is HttpOnly, lives ten
 *   minutes, and is sent only to this origin.
 * - **Signed with `AUTH_SECRET`.** Nothing else on the page depends on it, but
 *   the page prints it, and a value this app did not write is shown as nothing.
 * - **Cleared** when the person starts sign-in again or signs out
 *   (`hooks.after` in `config.ts`).
 *
 * Nothing here throws on bad input: a missing, tampered or expired cookie reads
 * as `null`, and the page falls back to "This Google account".
 */

/** The cookie's name. Prefixed so it never collides with Better Auth's own. */
export const REFUSED_SIGN_IN_COOKIE = "makerlab.refused_sign_in";

/** Ten minutes: long enough to read the page, short enough not to linger. */
export const REFUSED_SIGN_IN_MAX_AGE_SECONDS = 10 * 60;

/** Longest `retryPath` kept. An MCP authorization's query fits well inside it. */
const MAX_RETRY_PATH = 1500;

export interface RefusedSignIn {
  /** The address Google returned and this app refused. */
  email: string;
  /** A same-origin path to come back to after choosing another account. */
  retryPath: string;
}

/** What `setCookie` on a Better Auth endpoint context accepts, narrowed to what we use. */
interface CookieSetter {
  setCookie: (
    name: string,
    value: string,
    options: { httpOnly: boolean; sameSite: "lax"; path: string; maxAge: number; secure: boolean }
  ) => unknown;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/**
 * The cookie value for `refused`: base64url JSON, a dot, an HMAC over it. The
 * expiry is inside the signed part, so an old value cannot be replayed past
 * its ten minutes even by a browser that ignores `Max-Age`.
 */
export function encodeRefusedSignIn(refused: RefusedSignIn, secret: string, nowMs: number = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({
      e: refused.email,
      r: safeRetryPath(refused.retryPath),
      x: Math.floor(nowMs / 1000) + REFUSED_SIGN_IN_MAX_AGE_SECONDS,
    })
  ).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

/** The refused sign-in a cookie value names, or `null` if it is not one this app wrote, or has expired. */
export function decodeRefusedSignIn(
  value: string | null | undefined,
  secret: string | null | undefined,
  nowMs: number = Date.now()
): RefusedSignIn | null {
  if (!value || !secret) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(sign(payload, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      e?: unknown;
      r?: unknown;
      x?: unknown;
    };
    if (typeof parsed.e !== "string" || !parsed.e) return null;
    if (typeof parsed.x !== "number" || parsed.x * 1000 < nowMs) return null;
    return { email: parsed.e, retryPath: safeRetryPath(typeof parsed.r === "string" ? parsed.r : "/") };
  } catch {
    return null;
  }
}

/**
 * `path` as a same-origin path, or `/`.
 *
 * Better Auth keeps the `callbackURL` a sign-in started with, absolute or not.
 * Only this origin's own paths are carried forward: an absolute URL on
 * `origin` loses its origin, anything else (another host, `//host`, a
 * `javascript:` URL, an over-long value) becomes `/`. Sign-in validates the
 * callback again when it restarts, so this is tidiness, not the control.
 */
export function safeRetryPath(path: string | null | undefined, origin?: string): string {
  const raw = (path || "").trim();
  if (!raw) return "/";
  let candidate = raw;
  if (!raw.startsWith("/")) {
    if (!origin) return "/";
    try {
      const url = new URL(raw);
      if (url.origin !== new URL(origin).origin) return "/";
      candidate = `${url.pathname}${url.search}`;
    } catch {
      return "/";
    }
  }
  if (candidate.startsWith("//") || candidate.startsWith("/\\")) return "/";
  if (candidate.length > MAX_RETRY_PATH) return "/";
  return candidate;
}

/** Leave the cookie naming `refused` on the response `ctx` is building. A null context is a no-op. */
export function rememberRefusedSignIn(
  ctx: CookieSetter | null | undefined,
  refused: RefusedSignIn,
  options: { secret: string; secure: boolean }
): void {
  if (!ctx || !options.secret) return;
  ctx.setCookie(REFUSED_SIGN_IN_COOKIE, encodeRefusedSignIn(refused, options.secret), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: REFUSED_SIGN_IN_MAX_AGE_SECONDS,
    secure: options.secure,
  });
}

/** Expire the cookie on the response `ctx` is building. */
export function forgetRefusedSignIn(ctx: CookieSetter, options: { secure: boolean }): void {
  ctx.setCookie(REFUSED_SIGN_IN_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    secure: options.secure,
  });
}
