import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Must mock "server-only" before any import that pulls it in
vi.mock("server-only", () => ({}));

// We need to re-import a fresh module for each test to reset the in-memory store.
// Use vi.resetModules() + dynamic import.
let rateLimit: typeof import("@/lib/rate-limit").rateLimit;
let rateLimitAsync: typeof import("@/lib/rate-limit").rateLimitAsync;
let getClientIp: typeof import("@/lib/rate-limit").getClientIp;

describe("rate-limit", () => {
  beforeEach(async () => {
    vi.resetModules();
    // Ensure Upstash env vars are NOT set so we use in-memory mode
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");

    const mod = await import("@/lib/rate-limit");
    rateLimit = mod.rateLimit;
    rateLimitAsync = mod.rateLimitAsync;
    getClientIp = mod.getClientIp;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── rateLimit (synchronous, in-memory) ──────────────────────────

  describe("rateLimit", () => {
    it("allows requests under the limit", () => {
      const r1 = rateLimit("user-1", { limit: 3, windowMs: 60_000 });
      expect(r1.allowed).toBe(true);
      expect(r1.remaining).toBe(2);

      const r2 = rateLimit("user-1", { limit: 3, windowMs: 60_000 });
      expect(r2.allowed).toBe(true);
      expect(r2.remaining).toBe(1);

      const r3 = rateLimit("user-1", { limit: 3, windowMs: 60_000 });
      expect(r3.allowed).toBe(true);
      expect(r3.remaining).toBe(0);
    });

    it("blocks requests over the limit", () => {
      rateLimit("user-2", { limit: 2, windowMs: 60_000 });
      rateLimit("user-2", { limit: 2, windowMs: 60_000 });

      const blocked = rateLimit("user-2", { limit: 2, windowMs: 60_000 });
      expect(blocked.allowed).toBe(false);
      expect(blocked.remaining).toBe(0);
    });

    it("resets after window expires", () => {
      vi.useFakeTimers();

      rateLimit("user-3", { limit: 1, windowMs: 5_000 });
      const blocked = rateLimit("user-3", { limit: 1, windowMs: 5_000 });
      expect(blocked.allowed).toBe(false);

      // Advance past the window
      vi.advanceTimersByTime(5_001);

      const afterReset = rateLimit("user-3", { limit: 1, windowMs: 5_000 });
      expect(afterReset.allowed).toBe(true);
      expect(afterReset.remaining).toBe(0);
    });

    it("maintains independent limits for different keys", () => {
      rateLimit("key-a", { limit: 1, windowMs: 60_000 });
      const blockedA = rateLimit("key-a", { limit: 1, windowMs: 60_000 });
      expect(blockedA.allowed).toBe(false);

      // Different key should still be allowed
      const allowedB = rateLimit("key-b", { limit: 1, windowMs: 60_000 });
      expect(allowedB.allowed).toBe(true);
    });

    it("returns correct remaining count as requests accumulate", () => {
      const limit = 5;
      for (let i = 0; i < limit; i++) {
        const result = rateLimit("counter-key", { limit, windowMs: 60_000 });
        expect(result.remaining).toBe(limit - 1 - i);
      }

      // Once over the limit, remaining stays at 0
      const over = rateLimit("counter-key", { limit, windowMs: 60_000 });
      expect(over.remaining).toBe(0);
      expect(over.allowed).toBe(false);
    });

    it("remaining never goes below 0", () => {
      rateLimit("neg-test", { limit: 1, windowMs: 60_000 });
      const r2 = rateLimit("neg-test", { limit: 1, windowMs: 60_000 });
      const r3 = rateLimit("neg-test", { limit: 1, windowMs: 60_000 });

      expect(r2.remaining).toBe(0);
      expect(r3.remaining).toBe(0);
    });
  });

  // ── rateLimitAsync (falls back to sync when Upstash not configured) ─

  describe("rateLimitAsync", () => {
    it("delegates to in-memory rateLimit when Upstash is not configured", async () => {
      const result = await rateLimitAsync("async-key", {
        limit: 3,
        windowMs: 60_000,
      });

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2);
    });
  });

  // ── getClientIp ────────────────────────────────────────────────

  describe("getClientIp", () => {
    it("extracts IP from x-forwarded-for header", () => {
      const req = new Request("https://example.com", {
        headers: { "x-forwarded-for": "192.168.1.1, 10.0.0.1" },
      });

      expect(getClientIp(req)).toBe("192.168.1.1");
    });

    it("extracts single IP from x-forwarded-for header", () => {
      const req = new Request("https://example.com", {
        headers: { "x-forwarded-for": "203.0.113.50" },
      });

      expect(getClientIp(req)).toBe("203.0.113.50");
    });

    it("falls back to x-real-ip when x-forwarded-for is absent", () => {
      const req = new Request("https://example.com", {
        headers: { "x-real-ip": "10.0.0.5" },
      });

      expect(getClientIp(req)).toBe("10.0.0.5");
    });

    it("returns 'unknown' when no IP headers are present", () => {
      const req = new Request("https://example.com");

      expect(getClientIp(req)).toBe("unknown");
    });
  });
});
