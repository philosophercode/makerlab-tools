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

export async function classifyBackground(
  bytes: Uint8Array,
  opts: { loadSharp?: SharpLoader } = {}
): Promise<BackgroundClass | null> {
  const image = await loadRgba(bytes, CLASSIFY_LONG_EDGE, opts.loadSharp);
  return image ? classifyPixels(image) : null;
}

/** {@link classifyBackground} on pixels already decoded. */
export function classifyPixels({ data, width, height }: RgbaImage): BackgroundClass {
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

  const [r, g, b] = medianColour(data, opaque);
  if (luminance(r, g, b) < PLAIN_MIN_LUMINANCE) return "busy";

  // See-through border pixels agree with any backdrop.
  let matching = clear;
  for (const i of opaque) {
    const p = i * 4;
    if (colourDistance(data[p], data[p + 1], data[p + 2], r, g, b) <= PLAIN_TOLERANCE) matching += 1;
  }
  return matching / total >= PLAIN_BORDER_SHARE ? "plain" : "busy";
}
