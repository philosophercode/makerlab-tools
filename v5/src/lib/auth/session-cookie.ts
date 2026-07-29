import "server-only";

/**
 * The stateless signed session cookie (auth design spec 2026-07-29 §3.1).
 *
 * v5's only datastore is Notion, which is the wrong place for session rows, and
 * adding a database would defeat the reason v5 is simple to hand over. So there
 * is **no session table**: the cookie *is* the session — a base64url JSON payload
 * plus an HMAC-SHA256 signature over it, keyed by `AUTH_SECRET`.
 *
 * The accepted cost, recorded in the spec: **there is no server-side
 * revocation.** Removing access means removing the account from the Workspace
 * domain or rotating `AUTH_SECRET`, which signs everyone out.
 *
 * Nothing here throws on bad input. A malformed, tampered, or expired token is
 * indistinguishable from no token at all — it yields `null`, and the caller
 * degrades to anonymous.
 */

/** Cookie name. Prefixed rather than bare so it never collides with Better Auth's own. */
export const SESSION_COOKIE_NAME = "makerlab.identity";

/** 30 days, per spec §3.1. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * Rolling refresh threshold: re-sign the cookie once it is older than this, so
 * an active user's 30 days keep sliding forward and an idle one's expires.
 */
export const SESSION_REFRESH_AFTER_SECONDS = 24 * 60 * 60;

export interface SessionPayload {
  /** Google `sub` — the stable user id. */
  sub: string;
  email: string;
  name: string | null;
  /** Issued-at, seconds since epoch. */
  iat: number;
  /** Expiry, seconds since epoch. */
  exp: number;
}

/** Build a fresh payload for a user who has just signed in. */
export function createSessionPayload(
  user: { sub: string; email: string; name?: string | null },
  nowMs: number = Date.now(),
  maxAgeSeconds: number = SESSION_MAX_AGE_SECONDS
): SessionPayload {
  const iat = Math.floor(nowMs / 1000);
  return {
    sub: user.sub,
    email: user.email,
    name: user.name ?? null,
    iat,
    exp: iat + maxAgeSeconds,
  };
}

/** True when the payload is old enough that the rolling refresh should re-issue it. */
export function shouldRefreshSession(
  payload: SessionPayload,
  nowMs: number = Date.now()
): boolean {
  return Math.floor(nowMs / 1000) - payload.iat >= SESSION_REFRESH_AFTER_SECONDS;
}

// ── Signing / verification ─────────────────────────────────────────

const encoder = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

/** `<base64url(payload)>.<base64url(hmac)>` */
export async function signSession(
  payload: SessionPayload,
  secret: string
): Promise<string> {
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return `${body}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/**
 * Verify a token and return its payload, or `null` for **every** failure mode —
 * absent, malformed, wrong signature, expired, or no secret configured. The
 * signature check goes through `crypto.subtle.verify`, which compares in
 * constant time.
 */
export async function verifySessionToken(
  token: string | null | undefined,
  secret: string | null | undefined,
  nowMs: number = Date.now()
): Promise<SessionPayload | null> {
  if (!token || !secret) return null;
  try {
    const dot = token.indexOf(".");
    if (dot <= 0 || dot === token.length - 1) return null;
    const body = token.slice(0, dot);
    const signature = base64UrlDecode(token.slice(dot + 1));
    if (!signature) return null;

    const key = await hmacKey(secret);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      signature as BufferSource,
      encoder.encode(body)
    );
    if (!valid) return null;

    const decoded = base64UrlDecode(body);
    if (!decoded) return null;
    const parsed: unknown = JSON.parse(new TextDecoder().decode(decoded));
    const payload = asSessionPayload(parsed);
    if (!payload) return null;
    if (payload.exp * 1000 <= nowMs) return null;
    return payload;
  } catch {
    // A signed cookie we cannot parse is exactly as untrustworthy as no cookie.
    return null;
  }
}

function asSessionPayload(value: unknown): SessionPayload | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.sub !== "string" || !v.sub) return null;
  if (typeof v.email !== "string" || !v.email) return null;
  if (typeof v.iat !== "number" || typeof v.exp !== "number") return null;
  return {
    sub: v.sub,
    email: v.email,
    name: typeof v.name === "string" ? v.name : null,
    iat: v.iat,
    exp: v.exp,
  };
}

// ── Cookie plumbing ────────────────────────────────────────────────

export interface CookieAttributes {
  httpOnly: true;
  sameSite: "lax";
  path: "/";
  secure: boolean;
  maxAge: number;
}

/**
 * Attributes for the session cookie. `SameSite=Lax` so the OAuth redirect back
 * from Google still carries it; `Secure` everywhere except local development.
 */
export function sessionCookieAttributes(
  maxAgeSeconds: number = SESSION_MAX_AGE_SECONDS
): CookieAttributes {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: maxAgeSeconds,
  };
}

/** Serialize the session cookie for a `Set-Cookie` header. */
export function serializeSessionCookie(
  value: string,
  maxAgeSeconds: number = SESSION_MAX_AGE_SECONDS
): string {
  const attrs = sessionCookieAttributes(maxAgeSeconds);
  const parts = [
    `${SESSION_COOKIE_NAME}=${value}`,
    `Path=${attrs.path}`,
    `Max-Age=${attrs.maxAge}`,
    `SameSite=Lax`,
    "HttpOnly",
  ];
  if (attrs.secure) parts.push("Secure");
  return parts.join("; ");
}

/** Read one cookie out of a raw `Cookie` header. Returns null when absent. */
export function readCookie(
  header: string | null | undefined,
  name: string
): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    return value || null;
  }
  return null;
}

// ── base64url ──────────────────────────────────────────────────────

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decode base64url; returns null rather than throwing on malformed input. */
function base64UrlDecode(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}
