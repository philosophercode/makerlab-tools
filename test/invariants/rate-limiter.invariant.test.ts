import { randomUUID } from "node:crypto";
import { fc, RUNS } from "./fc";
import { rateLimit } from "@/lib/rate-limit";

/**
 * INVARIANT 12 — the rate limiter never lets more than its limit through.
 *
 * For any limit, window and burst of calls at any times (fake clock): within
 * one window of a key's first call, at most `limit` calls are allowed and the
 * first `limit` always are; once the window has passed the key has its full
 * allowance again; and two keys never share a budget.
 */

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const tier = fc.record({ limit: fc.integer({ min: 1, max: 20 }), windowMs: fc.integer({ min: 10, max: 60_000 }) });

describe("invariant: the limiter's allowance holds", () => {
  it("at most `limit` allowed per window, and the first `limit` always are", () => {
    fc.assert(
      fc.property(tier, fc.array(fc.nat({ max: 5_000 }), { minLength: 1, maxLength: 60 }), ({ limit, windowMs }, gaps) => {
        const key = `inv:${randomUUID()}`;
        vi.setSystemTime(1_000_000);
        let windowStart: number | null = null;
        let allowedInWindow = 0;
        let callsInWindow = 0;
        for (const gap of gaps) {
          vi.advanceTimersByTime(gap);
          if (windowStart === null || Date.now() > windowStart + windowMs) {
            windowStart = Date.now();
            allowedInWindow = 0;
            callsInWindow = 0;
          }
          const { allowed, remaining } = rateLimit(key, { limit, windowMs });
          callsInWindow++;
          if (allowed) allowedInWindow++;
          expect(allowedInWindow).toBeLessThanOrEqual(limit);
          expect(allowed).toBe(callsInWindow <= limit);
          expect(remaining).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: RUNS }
    );
  });

  it("two keys never share a budget", () => {
    fc.assert(
      fc.property(tier, fc.integer({ min: 1, max: 40 }), ({ limit, windowMs }, spent) => {
        const a = `inv:${randomUUID()}`;
        const b = `inv:${randomUUID()}`;
        for (let i = 0; i < spent; i++) rateLimit(a, { limit, windowMs });
        expect(rateLimit(b, { limit, windowMs }).allowed).toBe(true);
      }),
      { numRuns: RUNS }
    );
  });
});
