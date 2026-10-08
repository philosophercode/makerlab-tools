import { readFileSync } from "node:fs";
import { parseGalleryState } from "../components/gallery-filters";
import { ALL_TOOLS_PATH, FORMER_LIST_PATH, GALLERY_QUERY_KEYS, allToolsHref, categoryHref } from "./gallery-links";

/**
 * Where the tool list lives — the home page, since the student home spec's
 * amendment "One page: the list at rest" (2026-10-07) — and the redirect that
 * keeps old `/tools?category=…` links working.
 */

describe("gallery links", () => {
  it("point at the home page with the filter in the query", () => {
    expect(ALL_TOOLS_PATH).toBe("/");
    expect(categoryHref("3D Printing")).toBe("/?category=3D+Printing");
    expect(allToolsHref({ material: "Plywood", location: "Wood Shop" })).toBe("/?material=Plywood&location=Wood+Shop");
    expect(allToolsHref({})).toBe("/");
  });

  it("name every key the list reads", () => {
    const params = new URLSearchParams(GALLERY_QUERY_KEYS.map((key) => [key, "x"]));
    const parsed = parseGalleryState(params);
    // Each key is one the list understands (a nonsense value may fall back, but the key is read).
    expect(GALLERY_QUERY_KEYS).toEqual(["q", "status", "category", "material", "location", "kind", "view", "sort", "group"]);
    expect(parsed.query).toBe("x");
    expect(parsed.category).toBe("x");
  });

  it("leave the home page's own parameters (the kiosk's QR code) alone", () => {
    expect(GALLERY_QUERY_KEYS).not.toContain("ask" as never);
    expect(GALLERY_QUERY_KEYS).not.toContain("src" as never);
  });
});

describe("next.config redirects", () => {
  // Read as text, as remote-patterns.test.ts does: importing the config would load the Workflow and next-intl plugins.
  const source = readFileSync("next.config.ts", "utf8");

  it("send the former list address to the home page, temporarily (Next keeps the query string)", () => {
    expect(FORMER_LIST_PATH).toBe("/tools");
    expect(source).toMatch(/async redirects\(\)/);
    expect(source).toMatch(/\{ source: FORMER_LIST_PATH, destination: ALL_TOOLS_PATH, permanent: false \}/);
  });

  it("no longer send the home page anywhere: a filtered / is the list itself", () => {
    expect(source).not.toMatch(/source: "\/",/);
    expect(source).not.toMatch(/GALLERY_QUERY_KEYS\.map/);
  });

  it("leave the tool pages under /tools/ alone (the source is exactly /tools)", () => {
    // Next matches a redirect's source as a whole path: `/tools` does not match `/tools/form-4`.
    expect(source).not.toMatch(/source: FORMER_LIST_PATH.*:path/);
  });
});
