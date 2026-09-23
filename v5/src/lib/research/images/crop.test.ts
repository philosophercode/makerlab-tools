// @vitest-environment node
import { Canvas, decode, type Rgba } from "../../../../test/images/synthetic";
import {
  boxArea,
  boxToPixels,
  CROP_LONG_EDGE,
  CROP_PADDING,
  cropToBox,
  MIN_BOX_SHARE,
  padBox,
  parseProductBox,
  shouldCrop,
} from "./crop";

/**
 * Cropping to the product (amendment "Composites and product crop"): the box
 * the ranking model gives is validated strictly, padded and clamped, and cut
 * from the original's own pixels.
 */

const RED: Rgba = [200, 30, 30, 255];
const GREEN: Rgba = [30, 160, 60, 255];

describe("parseProductBox", () => {
  it("accepts a normalised box covering at least 4% of the image", () => {
    expect(parseProductBox([0.1, 0.2, 0.9, 0.8])).toEqual([0.1, 0.2, 0.9, 0.8]);
    expect(parseProductBox([0, 0, 1, 1])).toEqual([0, 0, 1, 1]);
    expect(parseProductBox([0.4, 0.4, 0.6, 0.6])).toEqual([0.4, 0.4, 0.6, 0.6]); // exactly 4%
    expect(MIN_BOX_SHARE).toBe(0.04);
  });

  it.each([
    ["null", null],
    ["an object", { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 }],
    ["five numbers", [0.1, 0.1, 0.9, 0.9, 1]],
    ["NaN", [Number.NaN, 0.1, 0.9, 0.9]],
    ["Infinity", [0.1, 0.1, Number.POSITIVE_INFINITY, 0.9]],
    ["reversed x", [0.9, 0.1, 0.1, 0.9]],
    ["zero height", [0.1, 0.5, 0.9, 0.5]],
    ["below zero", [0.1, -0.01, 0.9, 0.9]],
    ["above one", [0.1, 0.1, 0.9, 1.01]],
    ["too small", [0.4, 0.4, 0.59, 0.6]],
  ])("refuses %s", (_label, value) => {
    expect(parseProductBox(value)).toBeNull();
  });
});

describe("padBox and boxToPixels", () => {
  it(`pads ${CROP_PADDING * 100}% of the image on every side`, () => {
    const padded = padBox([0.3, 0.25, 0.7, 0.65]);
    expect(padded.map((n) => Number(n.toFixed(6)))).toEqual([0.26, 0.21, 0.74, 0.69]);
  });

  it("clamps the padding at the frame", () => {
    expect(padBox([0.01, 0, 1, 0.99])).toEqual([0, 0, 1, 1]);
    expect(padBox([0.5, 0.5, 0.98, 0.97], 0.1)).toEqual([0.4, 0.4, 1, 1]);
  });

  it("rounds outward to whole pixels and never leaves the image", () => {
    expect(boxToPixels([0.26, 0.21, 0.74, 0.69], 1000, 800)).toEqual({ left: 260, top: 168, width: 480, height: 384 });
    expect(boxToPixels([0.101, 0.101, 0.899, 0.899], 10, 10)).toEqual({ left: 1, top: 1, width: 8, height: 8 });
    expect(boxToPixels([0, 0, 1, 1], 640, 480)).toEqual({ left: 0, top: 0, width: 640, height: 480 });
    // A degenerate box still yields one pixel inside the frame.
    expect(boxToPixels([1, 1, 1, 1], 100, 100)).toEqual({ left: 99, top: 99, width: 1, height: 1 });
  });

  it("measures a box's share of the image", () => {
    expect(boxArea([0.25, 0.25, 0.75, 0.75])).toBeCloseTo(0.25);
  });
});

describe("shouldCrop", () => {
  const box = [0.3, 0.25, 0.7, 0.65] as const;
  const big = [0.02, 0.03, 0.97, 0.98] as const;

  it("crops a composite, a busy picture, or a product under 80% of the frame", () => {
    expect(shouldCrop(box, { composite: true, background: "plain" })).toBe(true);
    expect(shouldCrop(box, { composite: false, background: "busy" })).toBe(true);
    expect(shouldCrop(box, { composite: false, background: "plain" })).toBe(true);
    expect(shouldCrop([0.08, 0.08, 0.92, 0.92], { composite: false, background: "plain" })).toBe(true);
  });

  it("leaves a clean picture the product mostly fills, and anything without a box", () => {
    expect(shouldCrop([0.02, 0.02, 0.96, 0.96], { composite: false, background: "plain" })).toBe(false);
    expect(shouldCrop(null, { composite: true, background: "busy" })).toBe(false);
  });

  it("never crops when the padded box would keep nearly the whole picture", () => {
    expect(shouldCrop(big, { composite: true, background: "busy" })).toBe(false);
  });
});

describe("cropToBox", () => {
  it("cuts the padded box from the original's pixels, as PNG", async () => {
    // Left half red, right half green; the box straddles the middle.
    const source = new Canvas(1000, 500).paint((x) => (x < 500 ? RED : GREEN));
    const crop = await cropToBox(await source.png(), [0.4, 0.2, 0.6, 0.8]);
    expect(crop).not.toBeNull();
    expect(crop!.region).toEqual({ left: 360, top: 80, width: 280, height: 340 });
    expect(crop!.info).toMatchObject({ format: "image/png", width: 280, height: 340, hasAlpha: false });
    const pixels = await decode(crop!.bytes);
    const at = (x: number, y: number) => Array.from(pixels.data.slice((y * pixels.width + x) * 4, (y * pixels.width + x) * 4 + 4));
    expect(at(10, 10)).toEqual(RED);
    expect(at(139, 170)).toEqual(RED);
    expect(at(140, 170)).toEqual(GREEN);
    expect(at(279, 339)).toEqual(GREEN);
  });

  it(`shrinks a large crop to ${CROP_LONG_EDGE} px and keeps an alpha channel the original had`, async () => {
    const source = new Canvas(3000, 1500, [0, 0, 0, 0]).rect(500, 200, 2000, 1100, RED);
    const crop = await cropToBox(await source.png({ alpha: true }), [0.1, 0.1, 0.9, 0.9]);
    expect(crop!.info.hasAlpha).toBe(true);
    expect(Math.max(crop!.info.width, crop!.info.height)).toBe(CROP_LONG_EDGE);
  });

  it("answers null, never throws, without sharp or for bytes that are not an image", async () => {
    const png = await new Canvas(400, 400).png();
    expect(await cropToBox(png, [0.1, 0.1, 0.9, 0.9], { loadSharp: async () => null })).toBeNull();
    expect(await cropToBox(new TextEncoder().encode("nope"), [0.1, 0.1, 0.9, 0.9])).toBeNull();
  });
});
