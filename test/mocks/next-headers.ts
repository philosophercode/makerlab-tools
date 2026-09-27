import { vi } from "vitest";

/**
 * Factory for a `next/headers` mock, plus the knob that sets what it returns.
 *
 * `resolveIdentityFromHeaders()` and the `/admin` server actions read the
 * request through `next/headers`, which only exists inside a Next request
 * scope. Tests stub it and hand it a cookie minted by `test/utils/session.ts`,
 * which is what lets a server action be called directly as the person it is
 * about to refuse — or accept.
 *
 * Usage:
 *
 *   import { nextHeadersMock, setMockHeaders } from "@/../test/mocks/next-headers";
 *   vi.mock("next/headers", () => nextHeadersMock());
 *   …
 *   setMockHeaders({ cookie });          // signed in as whoever minted it
 *   setMockHeaders();                    // anonymous
 *
 * HOISTING CAVEAT: as with `next-cache.ts`, `vi.mock(...)` is hoisted above
 * your imports, so the factory must not close over module-scope variables.
 * The mutable state lives *here* instead, which is why `setMockHeaders` is
 * exported from this file rather than built in the test.
 */

let current = new Headers();

/** What the next `headers()` call will return. Call with nothing for anonymous. */
export function setMockHeaders(init: Record<string, string> = {}): void {
  current = new Headers(init);
}

export function nextHeadersMock() {
  return {
    headers: vi.fn(async () => current),
  };
}
