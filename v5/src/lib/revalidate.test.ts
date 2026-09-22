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
  it("clears the catalog tag under the profile the cached reads use", () => {
    invalidateCatalog();
    expect(revalidateTag).toHaveBeenCalledWith("catalog", "minutes");
  });
});

describe("invalidateProjects", () => {
  it("clears the projects tag", () => {
    invalidateProjects();
    expect(revalidateTag).toHaveBeenCalledWith("projects", "minutes");
  });
});

describe("ALL_TAGS", () => {
  it("is exactly what a full refresh has to clear", () => {
    expect([...ALL_TAGS]).toEqual(["catalog", "projects"]);
  });
});
