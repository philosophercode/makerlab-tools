import { server } from "../../test/msw/server";
import { http, HttpResponse } from "msw";

// NOTE: rate-limit.ts is a module singleton. `useUpstash` and the in-memory
// `store` Map are captured at module load. Tests that need a clean window OR a
// different Upstash config use `vi.resetModules()` + dynamic `import()`.
//
// For tests against the *default* (no-Upstash) build, we import lazily inside
// each test (after `vi.resetModules()`) and use distinct keys to avoid
// cross-test bleed through the shared singleton.

async function freshModule() {
  vi.resetModules();
  return import("@/lib/rate-limit");
}

function stubUpstashEnv() {
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example.com");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "tok");
}

describe("rateLimit (in-memory, sync)", () => {
  it("allows requests while under the limit", async () => {
    const { rateLimit } = await freshModule();
    const opts = { limit: 3, windowMs: 60_000 };

    expect(rateLimit("under-1", opts)).toEqual({ allowed: true, remaining: 2 });
    expect(rateLimit("under-1", opts)).toEqual({ allowed: true, remaining: 1 });
    expect(rateLimit("under-1", opts)).toEqual({ allowed: true, remaining: 0 });
  });

  it("denies once the count exceeds the limit", async () => {
    const { rateLimit } = await freshModule();
    const opts = { limit: 2, windowMs: 60_000 };

    expect(rateLimit("over-1", opts).allowed).toBe(true); // count 1
    expect(rateLimit("over-1", opts).allowed).toBe(true); // count 2 (== limit)
    expect(rateLimit("over-1", opts).allowed).toBe(false); // count 3 (> limit)
    expect(rateLimit("over-1", opts).allowed).toBe(false); // still denied
  });

  it("decrements remaining and floors it at 0", async () => {
    const { rateLimit } = await freshModule();
    const opts = { limit: 2, windowMs: 60_000 };

    expect(rateLimit("floor-1", opts).remaining).toBe(1);
    expect(rateLimit("floor-1", opts).remaining).toBe(0);
    // Once over the limit, remaining must not go negative.
    expect(rateLimit("floor-1", opts).remaining).toBe(0);
    expect(rateLimit("floor-1", opts).remaining).toBe(0);
  });

  it("resets the window after windowMs elapses (fake timers)", async () => {
    vi.useFakeTimers();
    try {
      const { rateLimit } = await freshModule();
      const opts = { limit: 1, windowMs: 1_000 };

      // First call allowed, second (same window) denied.
      expect(rateLimit("reset-1", opts).allowed).toBe(true);
      expect(rateLimit("reset-1", opts).allowed).toBe(false);

      // Advance past the window; the entry's resetAt is exceeded → fresh window.
      vi.advanceTimersByTime(1_001);

      expect(rateLimit("reset-1", opts)).toEqual({ allowed: true, remaining: 0 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("tracks distinct keys independently", async () => {
    const { rateLimit } = await freshModule();
    const opts = { limit: 1, windowMs: 60_000 };

    expect(rateLimit("key-a", opts).allowed).toBe(true);
    // Different key is unaffected by key-a's consumption.
    expect(rateLimit("key-b", opts).allowed).toBe(true);
    // key-a is now over its own limit.
    expect(rateLimit("key-a", opts).allowed).toBe(false);
  });

  it("throws (sync) when Upstash is configured", async () => {
    stubUpstashEnv();
    const { rateLimit } = await freshModule();

    expect(() => rateLimit("k", { limit: 5, windowMs: 1_000 })).toThrow(
      /rateLimitAsync must be used/
    );
  });
});

describe("rateLimitAsync — in-memory delegation (no Upstash env)", () => {
  it("allows under the limit and denies over it", async () => {
    const { rateLimitAsync } = await freshModule();
    const opts = { limit: 2, windowMs: 60_000 };

    expect(await rateLimitAsync("async-mem", opts)).toEqual({
      allowed: true,
      remaining: 1,
    });
    expect(await rateLimitAsync("async-mem", opts)).toEqual({
      allowed: true,
      remaining: 0,
    });
    expect(await rateLimitAsync("async-mem", opts)).toEqual({
      allowed: false,
      remaining: 0,
    });
  });
});

describe("rateLimitAsync — Upstash path (MSW /pipeline)", () => {
  it("returns allowed based on the INCR count (default handler → count 1)", async () => {
    stubUpstashEnv();
    const { rateLimitAsync } = await freshModule();

    // Default handler returns [{result:1},{result:1}] → count 1, allowed.
    const r = await rateLimitAsync("upstash-allow", { limit: 5, windowMs: 1_000 });
    expect(r).toEqual({ allowed: true, remaining: 4 });
  });

  it("denies when the INCR count exceeds the limit", async () => {
    stubUpstashEnv();
    server.use(
      http.post(/\/pipeline$/, () =>
        HttpResponse.json([{ result: 6 }, { result: 1 }])
      )
    );
    const { rateLimitAsync } = await freshModule();

    const r = await rateLimitAsync("upstash-deny", { limit: 5, windowMs: 1_000 });
    expect(r).toEqual({ allowed: false, remaining: 0 });
  });

  it("allows exactly at the limit (count === limit)", async () => {
    stubUpstashEnv();
    server.use(
      http.post(/\/pipeline$/, () =>
        HttpResponse.json([{ result: 5 }, { result: 1 }])
      )
    );
    const { rateLimitAsync } = await freshModule();

    const r = await rateLimitAsync("upstash-edge", { limit: 5, windowMs: 1_000 });
    expect(r).toEqual({ allowed: true, remaining: 0 });
  });

  it("fails open (allowed=true) when the pipeline responds non-ok", async () => {
    stubUpstashEnv();
    server.use(
      http.post(/\/pipeline$/, () =>
        HttpResponse.json({ error: "boom" }, { status: 500 })
      )
    );
    const { rateLimitAsync } = await freshModule();

    const r = await rateLimitAsync("upstash-failopen", { limit: 5, windowMs: 1_000 });
    expect(r).toEqual({ allowed: true, remaining: 4 });
  });
});

// ── Tiers + identity keying (auth design spec §8) ───────────────────

import type { Identity } from "@/lib/auth/identity";
import type { Role } from "@/lib/auth/roles";

function identity(role: Role, rateLimitKey: string): Identity {
  const signedIn = role !== "anonymous";
  return {
    role,
    userId: signedIn ? rateLimitKey.replace(/^user:/, "") : null,
    email: signedIn ? "someone@cornell.edu" : null,
    name: signedIn ? "Someone" : null,
    rateLimitKey,
  };
}

describe("chat tiers", () => {
  it("gives anonymous visitors the small allowance from the spec", async () => {
    const { chatTierFor } = await freshModule();
    expect(chatTierFor("anonymous")).toEqual({ limit: 8, windowMs: 3_600_000 });
  });

  it("gives signed-in students a generous allowance", async () => {
    const { chatTierFor } = await freshModule();
    expect(chatTierFor("student")).toEqual({ limit: 60, windowMs: 3_600_000 });
  });

  it("gives staff and admins the same, highest allowance", async () => {
    const { chatTierFor } = await freshModule();
    expect(chatTierFor("staff")).toEqual({ limit: 200, windowMs: 3_600_000 });
    expect(chatTierFor("admin")).toEqual({ limit: 200, windowMs: 3_600_000 });
  });

  it("lets RATE_LIMIT_ANON_CHAT raise the anonymous ceiling (conference NAT)", async () => {
    vi.stubEnv("RATE_LIMIT_ANON_CHAT", "40");
    const { chatTierFor } = await freshModule();
    expect(chatTierFor("anonymous").limit).toBe(40);
  });

  it("ignores a nonsense RATE_LIMIT_ANON_CHAT rather than disabling the limit", async () => {
    const { chatTierFor } = await freshModule();
    for (const bad of ["", "abc", "0", "-5"]) {
      vi.stubEnv("RATE_LIMIT_ANON_CHAT", bad);
      expect(chatTierFor("anonymous").limit).toBe(8);
    }
  });
});

describe("tierFor", () => {
  it("returns the chat tier for the chat scope", async () => {
    const { tierFor, chatTierFor } = await freshModule();
    expect(tierFor("chat", "student")).toEqual(chatTierFor("student"));
  });

  it("returns each route's unchanged pre-auth limit, regardless of role", async () => {
    const { tierFor } = await freshModule();
    expect(tierFor("flags", "anonymous")).toEqual(tierFor("flags", "admin"));
    expect(tierFor("flags", "anonymous").limit).toBe(5);
    expect(tierFor("health", "anonymous")).toEqual({ limit: 30, windowMs: 60_000 });
    expect(tierFor("mcp", "anonymous")).toEqual({ limit: 30, windowMs: 60_000 });
    expect(tierFor("projects", "anonymous")).toEqual({ limit: 10, windowMs: 60_000 });
    expect(tierFor("upload", "anonymous")).toEqual({ limit: 15, windowMs: 60_000 });
    expect(tierFor("auth", "anonymous")).toEqual({ limit: 20, windowMs: 60_000 });
  });
});

describe("checkRateLimit", () => {
  it("allows exactly the anonymous allowance, then refuses", async () => {
    const { checkRateLimit } = await freshModule();
    const anon = identity("anonymous", "ip:hash-anon-1");

    const allowed: boolean[] = [];
    for (let i = 0; i < 9; i += 1) {
      allowed.push((await checkRateLimit("chat", anon)).allowed);
    }
    expect(allowed).toEqual([...Array(8).fill(true), false]);
  });

  it("gives a student far more than the anonymous ceiling", async () => {
    const { checkRateLimit } = await freshModule();
    const student = identity("student", "user:sub-1");

    for (let i = 0; i < 20; i += 1) {
      expect((await checkRateLimit("chat", student)).allowed).toBe(true);
    }
    const decision = await checkRateLimit("chat", student);
    expect(decision.limit).toBe(60);
    expect(decision.role).toBe("student");
  });

  it("keys per identity — one caller's ceiling does not spend another's", async () => {
    const { checkRateLimit } = await freshModule();
    const a = identity("anonymous", "ip:hash-a");
    const b = identity("anonymous", "ip:hash-b");

    for (let i = 0; i < 8; i += 1) await checkRateLimit("chat", a);
    expect((await checkRateLimit("chat", a)).allowed).toBe(false);
    expect((await checkRateLimit("chat", b)).allowed).toBe(true);
  });

  it("keys per scope — chat and flags do not share a budget", async () => {
    const { checkRateLimit } = await freshModule();
    const anon = identity("anonymous", "ip:hash-scoped");

    for (let i = 0; i < 8; i += 1) await checkRateLimit("chat", anon);
    expect((await checkRateLimit("chat", anon)).allowed).toBe(false);
    expect((await checkRateLimit("flags", anon)).allowed).toBe(true);
  });

  it("reports the tier and a Retry-After in seconds", async () => {
    const { checkRateLimit } = await freshModule();
    const decision = await checkRateLimit("chat", identity("anonymous", "ip:hash-r"));
    expect(decision).toMatchObject({
      allowed: true,
      limit: 8,
      windowMs: 3_600_000,
      retryAfterSeconds: 3600,
      role: "anonymous",
    });
  });

  it("signing in resets the ceiling, because the key changes with the identity", async () => {
    const { checkRateLimit } = await freshModule();
    const anon = identity("anonymous", "ip:hash-upgrade");
    for (let i = 0; i < 8; i += 1) await checkRateLimit("chat", anon);
    expect((await checkRateLimit("chat", anon)).allowed).toBe(false);

    // Same person, same IP, now signed in — a fresh, larger allowance.
    const signedIn = identity("student", "user:sub-upgrade");
    expect((await checkRateLimit("chat", signedIn)).allowed).toBe(true);
  });
});

describe("getClientIp", () => {
  it("uses the first entry of x-forwarded-for", async () => {
    const { getClientIp } = await freshModule();
    const req = new Request("http://x", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(getClientIp(req)).toBe("1.2.3.4");
  });

  it("trims whitespace around the forwarded ip", async () => {
    const { getClientIp } = await freshModule();
    const req = new Request("http://x", {
      headers: { "x-forwarded-for": "  9.9.9.9  ,  1.1.1.1" },
    });
    expect(getClientIp(req)).toBe("9.9.9.9");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", async () => {
    const { getClientIp } = await freshModule();
    const req = new Request("http://x", {
      headers: { "x-real-ip": "8.8.8.8" },
    });
    expect(getClientIp(req)).toBe("8.8.8.8");
  });

  it('returns "unknown" when neither header is present', async () => {
    const { getClientIp } = await freshModule();
    const req = new Request("http://x");
    expect(getClientIp(req)).toBe("unknown");
  });
});
