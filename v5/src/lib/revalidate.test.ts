import { nextCacheMock } from "../../test/mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());

import { revalidateTag } from "next/cache";
import { ALL_TAGS, invalidateCatalog, invalidateProjects } from "./revalidate";

/**
 * The tag names, pinned.
 *
 * A save that busts the wrong tag fails silently: no error, no red test, just a
 * catalogue that does not show the edit and a person insisting they made it.
 * These assertions are the only thing standing between the write side and the
 * `cacheTag("catalog")` in `src/lib/catalog.ts`.
 */

beforeEach(() => {
  vi.mocked(revalidateTag).mockClear();
});

describe("invalidateCatalog", () => {
  it("clears the catalog tag", () => {
    invalidateCatalog();
    expect(revalidateTag).toHaveBeenCalledWith("catalog", { expire: 0 });
  });

  /**
   * The regression: a *named* profile is stale-while-revalidate in Next 16, so
   * the first reader after a publish is still served the pre-publish page —
   * which is the one failure §3.9 says invalidation exists to prevent. Only
   * `expire: 0` expires the entry where it stands.
   */
  it("expires it on the spot rather than letting one more reader have the old page", () => {
    invalidateCatalog();
    const [, profile] = vi.mocked(revalidateTag).mock.calls[0];
    expect(profile).not.toBe("minutes");
    expect(profile).toEqual({ expire: 0 });
  });
});

describe("invalidateProjects", () => {
  it("clears the projects tag, expiring it on the spot", () => {
    invalidateProjects();
    expect(revalidateTag).toHaveBeenCalledWith("projects", { expire: 0 });
  });
});

describe("ALL_TAGS", () => {
  it("is exactly what a full refresh has to clear", () => {
    expect([...ALL_TAGS]).toEqual(["catalog", "projects"]);
  });
});
