import "server-only";

import type { Identity } from "./auth/identity";
import type { Role } from "./auth/roles";

/**
 * Inbound rate limiting (auth design spec 2026-07-29 §8, Article 4).
 *
 * Two layers, deliberately:
 *
 * - The **store** (`rateLimit` / `rateLimitAsync`) is a sliding-window counter,
 *   in-memory by default and Upstash-backed when configured. It knows nothing
 *   about users.
 * - The **policy** (`checkRateLimit`) keys that store on an {@link Identity} and
 *   picks the tier for the caller's role. Every route resolves an identity first
 *   and limits on `identity.rateLimitKey` — the user id when signed in, a hashed
 *   IP when not — so a signed-in student is not punished for sharing a NAT and
 *   the store holds no personal data.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || "";
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const useUpstash = Boolean(UPSTASH_URL && UPSTASH_TOKEN);

// Clean up expired entries periodically (every 60s)
let lastCleanup = Date.now();
function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < 60_000) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key);
  }
}

/**
 * Simple in-memory sliding window rate limiter.
 * Resets on serverless cold start — good enough for abuse prevention.
 */
export function rateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number }
): { allowed: boolean; remaining: number } {
  // Keep sync behavior for callers. If Upstash is configured, callers should use rateLimitAsync.
  if (useUpstash) {
    throw new Error("rateLimitAsync must be used when Upstash Redis is configured");
  }
  cleanup();

  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1 };
  }

  entry.count++;
  const allowed = entry.count <= limit;
  return { allowed, remaining: Math.max(0, limit - entry.count) };
}

export async function rateLimitAsync(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number }
): Promise<{ allowed: boolean; remaining: number }> {
  if (!useUpstash) {
    return rateLimit(key, { limit, windowMs });
  }

  const redisKey = `rl:${key}`;
  const ttlSec = Math.max(1, Math.ceil(windowMs / 1000));
  const url = `${UPSTASH_URL}/pipeline`;
  const body = JSON.stringify([
    ["INCR", redisKey],
    ["EXPIRE", redisKey, ttlSec, "NX"],
  ]);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body,
    cache: "no-store",
  });

  if (!res.ok) {
    // Fail open to avoid downtime on transient Redis issues.
    return { allowed: true, remaining: limit - 1 };
  }

  const parsed = (await res.json()) as Array<{ result?: number }>;
  const count = Number(parsed?.[0]?.result || 0);
  const allowed = count <= limit;
  return { allowed, remaining: Math.max(0, limit - count) };
}

/** Extract client IP from request headers (works on Vercel) */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

// ── Tiers (design spec §8) ─────────────────────────────────────────

const HOUR_MS = 60 * 60_000;

export interface RateLimitTier {
  limit: number;
  windowMs: number;
}

/**
 * The anonymous chat allowance. Deliberately a guess (spec §11 Q3) — it should
 * comfortably cover an ISAM visitor's whole demo conversation while bounding a
 * scripted abuser. `RATE_LIMIT_ANON_CHAT` raises it without a code change, which
 * is the escape hatch for a conference where every visitor shares one NAT'd IP
 * (spec §11 Q4).
 */
const DEFAULT_ANON_CHAT_LIMIT = 8;

function anonChatLimit(): number {
  const raw = Number(process.env.RATE_LIMIT_ANON_CHAT);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_ANON_CHAT_LIMIT;
}

/**
 * Chat messages per hour, by role. Signed-in callers are keyed by user id, so
 * these are per-person; anonymous callers are keyed by hashed IP.
 */
export function chatTierFor(role: Role): RateLimitTier {
  switch (role) {
    case "admin":
    case "staff":
      return { limit: 200, windowMs: HOUR_MS };
    case "student":
      return { limit: 60, windowMs: HOUR_MS };
    default:
      return { limit: anonChatLimit(), windowMs: HOUR_MS };
  }
}

/**
 * Limits for the non-chat routes — unchanged from before sign-in existed. Only
 * the *key* got better (identity rather than raw IP); the numbers are the same.
 */
export const ROUTE_TIERS = {
  flags: { limit: 5, windowMs: HOUR_MS },
  health: { limit: 30, windowMs: 60_000 },
  mcp: { limit: 30, windowMs: 60_000 },
  projects: { limit: 10, windowMs: 60_000 },
  upload: { limit: 15, windowMs: 60_000 },
  auth: { limit: 20, windowMs: 60_000 },
} as const;

export type RouteScope = keyof typeof ROUTE_TIERS;
export type RateLimitScope = RouteScope | "chat";

/** The tier that applies to `scope` for a caller in `role`. */
export function tierFor(scope: RateLimitScope, role: Role): RateLimitTier {
  return scope === "chat" ? chatTierFor(role) : ROUTE_TIERS[scope];
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  limit: number;
  windowMs: number;
  /** Seconds a client should wait — the `Retry-After` value. */
  retryAfterSeconds: number;
  /** The role whose tier was applied, so callers can tailor the refusal. */
  role: Role;
}

/**
 * Check `scope` for `identity` and consume one unit of its allowance.
 *
 * Call this **before** any Notion fetch or model call (Article 4). The key is
 * `<scope>:<identity.rateLimitKey>`, which is stable for the life of a session
 * (user id) or of a client IP (hash) — a key that varied per request would make
 * the ceiling either unreachable or trivially bypassable.
 */
export async function checkRateLimit(
  scope: RateLimitScope,
  identity: Identity
): Promise<RateLimitDecision> {
  const tier = tierFor(scope, identity.role);
  const { allowed, remaining } = await rateLimitAsync(
    `${scope}:${identity.rateLimitKey}`,
    tier
  );

  if (!allowed) {
    // Instrumentation, per spec §8: the anonymous number is meant to be tuned
    // with real data, and it cannot be tuned if nothing records the ceiling.
    console.info(
      `[rate-limit] ceiling reached scope=${scope} role=${identity.role} limit=${tier.limit}`
    );
  }

  return {
    allowed,
    remaining,
    limit: tier.limit,
    windowMs: tier.windowMs,
    retryAfterSeconds: Math.ceil(tier.windowMs / 1000),
    role: identity.role,
  };
}
