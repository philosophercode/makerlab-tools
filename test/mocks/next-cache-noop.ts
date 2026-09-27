// No-op stand-in for `next/cache`, for runners with no Next build and no
// `vi.mock` — `npm run eval` (evals/vitest.config.ts aliases `next/cache` here).
//
// `catalog.ts` calls `cacheTag`/`cacheLife` inside `"use cache"` functions, and
// outside a Next build the real ones throw ("`cacheTag()` is only available with
// the `cacheComponents` config"), which stopped the eval suite in setup before
// any model call. Unit tests keep using `vi.mock("next/cache", () =>
// nextCacheMock())` (./next-cache.ts), which gives them spies to assert on.
export function cacheLife(): void {}
export function cacheTag(): void {}
export function revalidateTag(): void {}
export function revalidatePath(): void {}
