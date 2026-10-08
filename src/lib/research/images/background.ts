import type { BackgroundClass } from "../result.ts";
import type { SharpLoader } from "./downscale.ts";
import {
  borderBand,
  colourDistance,
  forEachBorderPixel,
  loadRgba,
  luminance,
  medianColour,
  type RgbaImage,
} from "./pixels.ts";

/**
 * What surrounds the product in a candidate image, read from the pixels in a
 * thin band around its edge (gateway spec, amendment "No generative redraw").
 *
 * - **`transparent`** — the image has alpha and at least
 *   {@link TRANSPARENT_BORDER_SHARE} of the band is see-through (alpha below
 *   {@link TRANSPARENT_ALPHA}): somebody already cut it out, and the original
 *   is the clean version.
 * - **`plain`** — the band is one light colour: its median is at least
 *   {@link PLAIN_MIN_LUMINANCE} bright (white, off-white, light grey) and at
 *   least {@link PLAIN_BORDER_SHARE} of it lies within
 *   {@link PLAIN_TOLERANCE} of that median — enough slack for JPEG noise, a
 *   soft studio gradient and a product that touches the frame in a place or two.
 * - **…or a product that comes within a few pixels of the frame** (amendment
 *   "Thin margins and white bezels", 2026-10-07). A frame-filling product —
 *   the iPad whose bezel reaches 3 px from the top edge — puts its own edge
 *   inside the band and fails the share above, though the backdrop is plain.
 *   So a band that fails is read once more from its **outermost ring** alone:
 *   `plain` when at least {@link PLAIN_RING_SHARE} of that ring is one light
 *   colour and at least {@link PLAIN_BAND_FLOOR} of the band still matches it
 *   — the product crowds the band, it does not fill it. A busy picture with a
 *   1 px light keyline stays busy: its band is mostly the picture.
 * - **`busy`** — anything else: a room, a bench, a dark backdrop, a texture.
 *
 * Work is done on a copy at most {@link CLASSIFY_LONG_EDGE} px long. Null when
 * the image cannot be decoded (or `sharp` is missing): unknown, not busy.
 *
 * Plain Node: step code imports this.
 */

/** The classifier's working size. Small on purpose: every probed candidate is classified. */
export const CLASSIFY_LONG_EDGE = 512;

/** Alpha below this counts as see-through. */
export const TRANSPARENT_ALPHA = 16;
/** Share of the border band that must be see-through for `transparent`. */
export const TRANSPARENT_BORDER_SHARE = 0.85;

/** The border's median must be at least this bright (0–255 luma) for `plain`. */
export const PLAIN_MIN_LUMINANCE = 190;
/** RGB distance from the border's median that still counts as the backdrop. */
export const PLAIN_TOLERANCE = 48;
/** Share of the border band that must be the backdrop colour for `plain`. */
export const PLAIN_BORDER_SHARE = 0.85;
/** The fallback: share of the outermost ring that must be the backdrop colour… */
export const PLAIN_RING_SHARE = 0.9;
/** …and share of the whole band that must still match it. */
export const PLAIN_BAND_FLOOR = 0.3;

export async function classifyBackground(
  bytes: Uint8Array,
  opts: { loadSharp?: SharpLoader } = {}
): Promise<BackgroundClass | null> {
  const image = await loadRgba(bytes, CLASSIFY_LONG_EDGE, opts.loadSharp);
  return image ? classifyPixels(image) : null;
}

/** {@link classifyBackground} on pixels already decoded. */
export function classifyPixels(image: RgbaImage): BackgroundClass {
  const { data, width, height } = image;
  const band = borderBand(width, height);
  const opaque: number[] = [];
  let total = 0;
  let clear = 0;
  forEachBorderPixel(width, height, band, (i) => {
    total += 1;
    if (data[i * 4 + 3] < TRANSPARENT_ALPHA) clear += 1;
    else opaque.push(i);
  });
  if (total === 0) return "busy";
  if (clear / total >= TRANSPARENT_BORDER_SHARE) return "transparent";
  if (opaque.length === 0) return "busy";

  const median = medianColour(data, opaque);
  if (luminance(...median) >= PLAIN_MIN_LUMINANCE && matchingShare(data, opaque, clear, median) >= PLAIN_BORDER_SHARE) {
    return "plain";
  }
  return productCrowdsTheBand(image, band) ? "plain" : "busy";
}

/** Share of `pixels` (plus `clear` see-through ones, which agree with any backdrop) within tolerance of `colour`. */
function matchingShare(data: Uint8Array, pixels: readonly number[], clear: number, [r, g, b]: [number, number, number]): number {
  let matching = clear;
  for (const i of pixels) {
    const p = i * 4;
    if (colourDistance(data[p], data[p + 1], data[p + 2], r, g, b) <= PLAIN_TOLERANCE) matching += 1;
  }
  return matching / (pixels.length + clear);
}

/**
 * The fallback for a band that failed: a plain light outermost ring, with the
 * band still mostly that colour — a product reaching into the band, not a
 * picture filling it.
 */
function productCrowdsTheBand({ data, width, height }: RgbaImage, band: number): boolean {
  const ring: number[] = [];
  let ringClear = 0;
  forEachBorderPixel(width, height, 1, (i) => {
    if (data[i * 4 + 3] < TRANSPARENT_ALPHA) ringClear += 1;
    else ring.push(i);
  });
  if (ring.length === 0) return false;
  const median = medianColour(data, ring);
  if (luminance(...median) < PLAIN_MIN_LUMINANCE) return false;
  if (matchingShare(data, ring, ringClear, median) < PLAIN_RING_SHARE) return false;

  const bandPixels: number[] = [];
  let bandClear = 0;
  forEachBorderPixel(width, height, band, (i) => {
    if (data[i * 4 + 3] < TRANSPARENT_ALPHA) bandClear += 1;
    else bandPixels.push(i);
  });
  return matchingShare(data, bandPixels, bandClear, median) >= PLAIN_BAND_FLOOR;
}
