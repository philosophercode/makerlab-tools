// @vitest-environment node

import { MARKER_SIZE, markerHeic, markerIrotHeic } from "../../../test/fixtures/photos/heic";
import { makePng } from "../../../test/gateway/png";
import { decodeHeif, isHeif } from "./heif";

/**
 * Reading a HEIC on the server (data platform spec amendment 2026-10-08) —
 * against two real HEVC-coded files and the real `heic-decode` (libheif in
 * WebAssembly), not a stand-in, so a version that stops decoding iPhone photos
 * fails here.
 */

/** An `ftyp` box with the given brands, as the first bytes of a file. */
function ftyp(major: string, ...compatible: string[]): Uint8Array {
  const size = 16 + compatible.length * 4;
  const bytes = new Uint8Array(size + 8);
  new DataView(bytes.buffer).setUint32(0, size);
  bytes.set(new TextEncoder().encode(`ftyp${major}\0\0\0\0${compatible.join("")}`), 4);
  return bytes;
}

function pixel(image: { width: number; data: Uint8ClampedArray }, x: number, y: number): number[] {
  const at = (y * image.width + x) * 4;
  return Array.from(image.data.subarray(at, at + 3));
}

/** Close to a colour, allowing for the codec's rounding. */
function near(actual: number[], expected: number[]) {
  return actual.every((value, i) => Math.abs(value - expected[i]) <= 12);
}

describe("isHeif", () => {
  it("knows an iPhone-style HEIC by its brands", () => {
    expect(isHeif(markerHeic())).toBe(true);
    expect(isHeif(ftyp("heic", "mif1", "heic"))).toBe(true);
    expect(isHeif(ftyp("heix"))).toBe(true);
    expect(isHeif(ftyp("mif1", "heic"))).toBe(true);
  });

  it("does not take AVIF, which shares the HEIF container, or anything else", () => {
    expect(isHeif(ftyp("avif", "mif1", "miaf"))).toBe(false);
    expect(isHeif(ftyp("mif1", "avif", "miaf"))).toBe(false);
    expect(isHeif(ftyp("isom", "mp41"))).toBe(false);
    expect(isHeif(makePng({ width: 4, height: 4, alpha: false }))).toBe(false);
    expect(isHeif(new Uint8Array(8))).toBe(false);
  });
});

describe("decodeHeif", () => {
  it("decodes a real HEIC to RGBA pixels", async () => {
    const image = await decodeHeif(markerHeic());

    expect(image).not.toBeNull();
    if (!image) return;
    expect({ width: image.width, height: image.height }).toEqual(MARKER_SIZE);
    expect(image.data).toHaveLength(MARKER_SIZE.width * MARKER_SIZE.height * 4);
    expect(near(pixel(image, 4, 4), [0, 255, 0])).toBe(true); // the green marker, top-left
    expect(near(pixel(image, 30, 40), [255, 0, 0])).toBe(true);
    expect(near(pixel(image, 80, 40), [0, 0, 255])).toBe(true);
  });

  it("applies the HEIF rotation an iPhone records, so a portrait photo comes out upright", async () => {
    const image = await decodeHeif(markerIrotHeic());

    expect(image && { width: image.width, height: image.height }).toEqual({ width: 64, height: 96 });
    if (!image) return;
    // 90° anticlockwise: the top-left marker is now bottom-left.
    expect(near(pixel(image, 4, image.height - 5), [0, 255, 0])).toBe(true);
    expect(near(pixel(image, 4, 4), [0, 0, 255])).toBe(true);
  });

  it("refuses a file claiming more pixels than the limit, before decoding it", async () => {
    expect(await decodeHeif(markerHeic(), { maxPixels: 96 * 64 - 1 })).toBeNull();
  });

  it("answers null, never throws, for a corrupt file or a decoder that will not load", async () => {
    const corrupt = markerHeic().slice(0, 300);
    expect(await decodeHeif(corrupt)).toBeNull();

    const failing = async () => {
      throw new Error("Cannot find module 'heic-decode'");
    };
    expect(await decodeHeif(markerHeic(), { load: failing })).toBeNull();
  });

  it("does not load the decoder for a file that is not HEIC", async () => {
    const load = vi.fn();
    expect(await decodeHeif(makePng({ width: 4, height: 4, alpha: false }), { load })).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });
});
