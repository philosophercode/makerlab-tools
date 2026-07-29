import "server-only";

import { getClientIp } from "../rate-limit";
import { isAllowedEmail, roleForEmail, type Role } from "./roles";
import {
  SESSION_COOKIE_NAME,
  readCookie,
  verifySessionToken,
  type SessionPayload,
} from "./session-cookie";

/**
 * `resolveIdentity(req)` — the one module everything else uses to learn who is
 * making a request (auth design spec 2026-07-29 §3.2).
 *
 * Identity is **context, not a capability**: it is resolved once per request and
 * handed to whatever needs it. Nothing here is an authorization decision — v5
 * gates no capability on role, and the write-safety model is still
 * drafts-by-default (Article 5).
 *
 * **It never throws.** An absent, expired, tampered, or nonsense cookie yields
 * the anonymous identity, because anonymous is a first-class state and not a
 * failure. A 500 from a stale cookie is on the spec's list of things that would
 * embarrass us in production (§10).
 */

export interface Identity {
  role: Role;
  /** Google `sub`, or null when anonymous. */
  userId: string | null;
  email: string | null;
  name: string | null;
  /** Stable key for rate limiting: user id when signed in, hashed IP otherwise. */
  rateLimitKey: string;
}

export type { Role };

/** Resolve a request to an {@link Identity}. Never rejects. */
export async function resolveIdentity(req: Request): Promise<Identity> {
  let payload: SessionPayload | null = null;
  try {
    const token = readCookie(req.headers.get("cookie"), SESSION_COOKIE_NAME);
    payload = await verifySessionToken(token, authSecret());
  } catch (err) {
    // Defensive: verifySessionToken already swallows its own failures, so this
    // only fires if reading headers itself blows up. Log it — a silently
    // anonymous population is a symptom worth seeing — and carry on.
    if (isFrameworkSignal(err)) throw err;
    console.warn("[auth] identity resolution failed, treating as anonymous", err);
    payload = null;
  }

  if (payload && isAllowedEmail(payload.email)) {
    const role = roleForEmail(payload.email);
    if (role !== "anonymous") {
      return {
        role,
        userId: payload.sub,
        email: payload.email,
        name: payload.name,
        rateLimitKey: `user:${payload.sub}`,
      };
    }
  }

  return anonymousIdentity(req);
}

/** The anonymous identity for a request, keyed by a hash of its client IP. */
export async function anonymousIdentity(req: Request): Promise<Identity> {
  let ip = "unknown";
  try {
    ip = getClientIp(req);
  } catch (err) {
    // A request without usable headers still gets a (shared) bucket.
    if (isFrameworkSignal(err)) throw err;
  }
  return {
    role: "anonymous",
    userId: null,
    email: null,
    name: null,
    rateLimitKey: `ip:${await hashIp(ip)}`,
  };
}

/** The identity used when no request is available (background jobs, tests). */
export function systemAnonymousIdentity(): Identity {
  return {
    role: "anonymous",
    userId: null,
    email: null,
    name: null,
    rateLimitKey: "ip:unknown",
  };
}

/**
 * `sha256(ip + AUTH_SECRET)`, hex. The rate-limit store therefore holds no
 * personal data (spec §8) while still bucketing one visitor to one key.
 *
 * Falls back to a non-cryptographic hash if WebCrypto is unavailable — still no
 * raw IP in the store, and still deterministic, which is what the limiter needs.
 */
export async function hashIp(
  ip: string,
  secret: string = authSecret()
): Promise<string> {
  const input = `${ip}${secret}`;
  try {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(input)
    );
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return fallbackHash(input);
  }
}

/**
 * Next signals control flow with thrown errors carrying a `digest` — reading
 * request headers during a prerender raises `NEXT_PRERENDER_INTERRUPTED` to mark
 * the route dynamic. Those are not failures and must never be swallowed: doing
 * so would silently prerender a route that has to run per request.
 */
function isFrameworkSignal(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "digest" in err);
}

/** FNV-1a, used only when WebCrypto is missing. */
function fallbackHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a-${hash.toString(16).padStart(8, "0")}`;
}

/**
 * `AUTH_SECRET`, read at call time. Absent in local/mock deployments, where no
 * cookie can verify and everyone is anonymous — which is the correct degraded
 * behaviour, not an error.
 */
export function authSecret(): string {
  return process.env.AUTH_SECRET || "";
}
