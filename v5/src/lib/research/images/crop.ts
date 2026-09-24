import { inspectImage, type ImageInfo } from "../../images/inspect.ts";
import { loadSharp, type SharpLoader } from "./downscale.ts";

/**
 * Cropping a candidate to its product (gateway spec amendment "Composites and
 * product crop"). A store's banner — a price bar on top, the machine in the
 * middle, promotional tiles below — has a product in it worth keeping; the
 * ranking model says where (`productBox`), and this cuts the **original's own
 * pixels** to that box. Nothing is redrawn: the crop is a rectangle of the
 * picture, and the cutout (`clean.ts`) may then remove a plain backdrop from it.
 *
 * - **The box is validated strictly** ({@link parseProductBox}): four finite
 *   numbers, normalised to 0–1, `x0 < x1` and `y0 < y1`, covering at least
 *   {@link MIN_BOX_SHARE} of the image. Anything else is no box.
 * - **Padded, then clamped** ({@link padBox}): {@link CROP_PADDING} of the
 *   image's width (and height) on each side, so a box drawn a little tight
 *   does not cut the machine's edge off, never past the frame — then 2% and
 *   1% ({@link CROP_PADDINGS}) when a wider crop's edge caught a banner's
 *   neighbouring panels.
 * - **Worth it only when it changes something** ({@link shouldCrop}): the
 *   image is a composite, or its background is busy, or the product covers
 *   less than {@link CROP_WHEN_BOX_BELOW} of it.
 *
 * Plain Node: step code imports this.
 */

/** `[x0, y0, x1, y1]`, each 0–1 of the image's width or height. */
export type ProductBox = readonly [number, number, number, number];

const EPSILON = 1e-9;

/** A box smaller than this share of the image is not a product anyone could use. */
export const MIN_BOX_SHARE = 0.04;

/** Padding added on every side of the box, as a share of the image's width and height. */
export const CROP_PADDING = 0.04;

/**
 * The paddings tried in turn, widest first: a banner's price bar or tiles can
 * reach into a 4% margin and make the crop's edge busy, where 2% or 1% clears
 * them (the model's box is drawn tight around the machine).
 */
export const CROP_PADDINGS = [CROP_PADDING, 0.02, 0.01] as const;

/** A crop kept alone (its backdrop could not be cut) is padded this much: some margin, less of the neighbours. */
export const CROP_ONLY_PADDING = 0.02;

/** A product covering at least this share of a clean, non-composite image is not cropped. */
export const CROP_WHEN_BOX_BELOW = 0.8;

/** The original is read at most this long before the box is cut from it. */
const CROP_SOURCE_LONG_EDGE = 2048;

/** The crop's long edge at most, in pixels — the cutout's working size; a cover, not a print. */
export const CROP_LONG_EDGE = 1024;

/** A model's `productBox`, or null when it is anything but a usable normalised box. */
export function parseProductBox(value: unknown): ProductBox | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  if (!value.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const [x0, y0, x1, y1] = value as number[];
  if (x0 < 0 || y0 < 0 || x1 > 1 || y1 > 1) return null;
  if (!(x0 < x1) || !(y0 < y1)) return null;
  const box: ProductBox = [x0, y0, x1, y1];
  // The epsilon forgives floating point: [0.4, 0.4, 0.6, 0.6] is 4%, not 3.99999…%.
  return boxArea(box) >= MIN_BOX_SHARE - EPSILON ? box : null;
}

/** The share of the image a normalised box covers. */
export function boxArea([x0, y0, x1, y1]: ProductBox): number {
  return (x1 - x0) * (y1 - y0);
}

/** The box grown by `padding` on each side, clamped to the frame. */
export function padBox([x0, y0, x1, y1]: ProductBox, padding = CROP_PADDING): ProductBox {
  return [Math.max(0, x0 - padding), Math.max(0, y0 - padding), Math.min(1, x1 + padding), Math.min(1, y1 + padding)];
}

/** `box` in the coordinates of `frame` (both normalised to the same image), clamped to 0–1. */
export function boxWithin(box: ProductBox, frame: ProductBox): ProductBox {
  const w = frame[2] - frame[0];
  const h = frame[3] - frame[1];
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  return [clamp((box[0] - frame[0]) / w), clamp((box[1] - frame[1]) / h), clamp((box[2] - frame[0]) / w), clamp((box[3] - frame[1]) / h)];
}

/** A normalised box as whole pixels of a `width` × `height` image: at least 1 px, never past the edge. */
export function boxToPixels(
  [x0, y0, x1, y1]: ProductBox,
  width: number,
  height: number
): { left: number; top: number; width: number; height: number } {
  // Outward to whole pixels, forgiving floating point (0.84 × 500 is 420.00000000000006, not 421).
  const left = Math.min(width - 1, Math.max(0, Math.floor(x0 * width + EPSILON)));
  const top = Math.min(height - 1, Math.max(0, Math.floor(y0 * height + EPSILON)));
  const right = Math.min(width, Math.max(left + 1, Math.ceil(x1 * width - EPSILON)));
  const bottom = Math.min(height, Math.max(top + 1, Math.ceil(y1 * height - EPSILON)));
  return { left, top, width: right - left, height: bottom - top };
}

/** A crop must leave out at least this share of the image (after padding), or it changes nothing worth storing. */
export const MIN_CROP_GAIN = 0.1;

/**
 * Whether rank 1 should be cropped to its box before anything else: there is
 * a box, the padded crop leaves out at least {@link MIN_CROP_GAIN} of the
 * picture, and the picture is a composite, busy, or mostly not the product.
 */
export function shouldCrop(
  box: ProductBox | null,
  signals: { composite: boolean; background: "transparent" | "plain" | "busy" | null }
): box is ProductBox {
  if (!box) return false;
  if (boxArea(padBox(box)) > 1 - MIN_CROP_GAIN) return false;
  return signals.composite || signals.background === "busy" || boxArea(box) < CROP_WHEN_BOX_BELOW;
}

export interface CroppedImage {
  /** PNG: lossless, so the cutout reads the same pixels the original had (and keeps any alpha). */
  bytes: Uint8Array;
  info: ImageInfo;
  /** The rectangle taken, in the (EXIF-rotated) working copy's pixels. */
  region: { left: number; top: number; width: number; height: number };
}

/**
 * `bytes` cropped to `box` padded by {@link CROP_PADDING}, shrunk to at most
 * {@link CROP_LONG_EDGE}, as PNG. Null when `sharp` is missing or the image
 * does not decode. Never throws.
 */
export async function cropToBox(
  bytes: Uint8Array,
  box: ProductBox,
  opts: { loadSharp?: SharpLoader; padding?: number } = {}
): Promise<CroppedImage | null> {
  let sharp: Awaited<ReturnType<SharpLoader>>;
  try {
    sharp = await (opts.loadSharp ?? loadSharp)();
  } catch {
    return null;
  }
  if (!sharp) return null;

  try {
    // Rotate first and materialise, so the box is read against the picture as it is seen.
    // A working copy at most CROP_SOURCE_LONG_EDGE long bounds the memory a 6000 px photo would take.
    const { data, info } = await sharp(bytes, { failOn: "error", limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: CROP_SOURCE_LONG_EDGE, height: CROP_SOURCE_LONG_EDGE, fit: "inside", withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.channels !== 3 && info.channels !== 4) return null;
    const region = boxToPixels(padBox(box, opts.padding ?? CROP_PADDING), info.width, info.height);
    const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
      .extract(region)
      .resize({ width: CROP_LONG_EDGE, height: CROP_LONG_EDGE, fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const out = new Uint8Array(png.buffer, png.byteOffset, png.byteLength);
    const inspected = inspectImage(out);
    return inspected ? { bytes: out, info: inspected, region } : null;
  } catch {
    return null;
  }
}
