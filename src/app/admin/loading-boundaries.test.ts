// @vitest-environment node
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every admin segment that has a page below it carries its own `loading.tsx`
 * (DESIGN.md §8.12 "Admin navigation never waits on a hole").
 *
 * Each admin page reads the request at its root, so its prefetched segment is
 * a shell with a dynamic hole. A client navigation into a segment with no
 * Suspense boundary of its own suspended on that hole behind a boundary that
 * was already on screen, and in the production build that transition was
 * sometimes never retried — the page never mounted. A folder added under
 * `app/admin` with a page below it and no `loading.tsx` would bring that back
 * for navigations between its children; this says which folder.
 */

const ADMIN = fileURLToPath(new URL(".", import.meta.url));

function subdirectories(dir: string): string[] {
  return readdirSync(dir)
    .map((name) => join(dir, name))
    .filter((path) => statSync(path).isDirectory());
}

function hasPageBelow(dir: string): boolean {
  return subdirectories(dir).some((child) => existsSync(join(child, "page.tsx")) || hasPageBelow(child));
}

function allDirectories(dir: string): string[] {
  return [dir, ...subdirectories(dir).flatMap(allDirectories)];
}

describe("admin loading boundaries", () => {
  it("has a loading.tsx in every admin folder with a page below it", () => {
    const missing = allDirectories(ADMIN)
      .filter((dir) => hasPageBelow(dir) && !existsSync(join(dir, "loading.tsx")))
      .map((dir) => relative(ADMIN, dir) || ".");
    expect(missing).toEqual([]);
  });

  it("covers the admin root and the nested sections", () => {
    for (const dir of [".", "intake", "intake/(tabs)", "intake/(tabs)/imports", "intake/imports", "refresh"]) {
      expect(existsSync(join(ADMIN, dir, "loading.tsx")), dir).toBe(true);
    }
  });
});
