import "server-only";

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
