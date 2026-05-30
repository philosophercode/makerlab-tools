import { vi } from "vitest";

/**
 * Factory for a `next/cache` mock. `catalog.ts` imports `cacheTag`/`cacheLife`
 * and `admin/revalidate/route.ts` imports `revalidateTag`; all three only work
 * inside the Next build, so tests stub them.
 *
 * Usage:
 *
 *   import { nextCacheMock } from "@/../test/mocks/next-cache";
 *   vi.mock("next/cache", () => nextCacheMock());
 *
 * HOISTING CAVEAT: `vi.mock(...)` is hoisted to the top of the module by Vitest,
 * *above* your imports. The factory passed to `vi.mock` must therefore not
 * reference any variable from the surrounding module scope (it runs before they
 * exist). Calling `nextCacheMock()` *inline* inside the factory is safe because
 * the import of this file is itself hoisted alongside the mock. If you need to
 * assert on the mock fns later, grab them from the mocked module:
 *
 *   import { cacheTag, revalidateTag } from "next/cache";
 *   expect(vi.mocked(revalidateTag)).toHaveBeenCalledWith("catalog");
 */
export function nextCacheMock() {
  return {
    cacheLife: vi.fn(),
    cacheTag: vi.fn(),
    revalidateTag: vi.fn(),
  };
}
