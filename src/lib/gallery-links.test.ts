import { readFileSync } from "node:fs";
import { parseGalleryState } from "../components/gallery-filters";
import { ALL_TOOLS_PATH, GALLERY_QUERY_KEYS, allToolsHref, categoryHref } from "./gallery-links";

/**
 * Where the full list lives since the student home (spec 2026-10-07 §5), and
 * the redirects that keep old `/?category=…` links working.
 */

describe("gallery links", () => {
  it("point at /tools with the filter in the query", () => {
    expect(ALL_TOOLS_PATH).toBe("/tools");
    expect(categoryHref("3D Printing")).toBe("/tools?category=3D+Printing");
    expect(allToolsHref({ material: "Plywood", location: "Wood Shop" })).toBe("/tools?material=Plywood&location=Wood+Shop");
    expect(allToolsHref({})).toBe("/tools");
  });

  it("name every key the full list reads", () => {
    const params = new URLSearchParams(GALLERY_QUERY_KEYS.map((key) => [key, "x"]));
    const parsed = parseGalleryState(params);
    // Each key is one the list understands (a nonsense value may fall back, but the key is read).
    expect(GALLERY_QUERY_KEYS).toEqual(["q", "status", "category", "material", "location", "kind", "view", "sort", "group"]);
    expect(parsed.query).toBe("x");
    expect(parsed.category).toBe("x");
  });
});

describe("next.config redirects", () => {
  // Read as text, as remote-patterns.test.ts does: importing the config would load the Workflow and next-intl plugins.
  const source = readFileSync("next.config.ts", "utf8");

  it("send / with any list filter to /tools, temporarily, query and all", () => {
    expect(source).toMatch(/async redirects\(\)/);
    expect(source).toMatch(/GALLERY_QUERY_KEYS\.map\(\(key\) => \(\{/);
    expect(source).toMatch(/source: "\/"/);
    expect(source).toMatch(/has: \[\{ type: "query" as const, key \}\]/);
    expect(source).toMatch(/destination: ALL_TOOLS_PATH/);
    expect(source).toMatch(/permanent: false/);
  });

  it("leave the home page's own parameters (the kiosk's QR code) alone", () => {
    expect(GALLERY_QUERY_KEYS).not.toContain("ask" as never);
    expect(GALLERY_QUERY_KEYS).not.toContain("src" as never);
  });
});
