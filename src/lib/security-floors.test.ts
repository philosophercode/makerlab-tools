import { createRequire } from "node:module";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

/**
 * Minimum patched versions of the runtime dependencies that parse untrusted
 * input (security/deps, 2026-10-05). A lockfile change that slides either one
 * back below its floor fails here instead of shipping.
 *
 * - sharp ≥ 0.35.4: libvips (GHSA-f88m-g3jw-g9cj) and libheif
 *   (GHSA-rgj7-g3m4-5g8c) memory-safety fixes. Member photo uploads and
 *   web-scraped research images are decoded with it.
 * - next ≥ 16.3.6: the RSC / Server Action DoS, cacheComponents cache
 *   confusion and next/og ImageResponse (GHSA-vcvr-r3jv-pc5j) fixes.
 */

const require = createRequire(import.meta.url);

function installedVersion(pkg: string): string {
  return (require(`${pkg}/package.json`) as { version: string }).version;
}

function atLeast(version: string, floor: string): boolean {
  const parse = (v: string) => v.split("-")[0].split(".").map(Number);
  const a = parse(version);
  const b = parse(floor);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

describe("security floors for dependencies that parse untrusted input", () => {
  it("compares versions numerically", () => {
    expect(atLeast("0.35.10", "0.35.4")).toBe(true);
    expect(atLeast("0.34.5", "0.35.4")).toBe(false);
    expect(atLeast("16.3.6", "16.3.6")).toBe(true);
    expect(atLeast("16.1.6", "16.3.6")).toBe(false);
  });

  it("sharp is at or above 0.35.4", () => {
    // The version the loaded native module reports, not just the lockfile's.
    expect(atLeast(sharp.versions.sharp, "0.35.4")).toBe(true);
  });

  it("next is at or above 16.3.6", () => {
    expect(atLeast(installedVersion("next"), "16.3.6")).toBe(true);
  });
});
