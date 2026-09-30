import { createHash } from "node:crypto";
import { loadSharp, type SharpLoader } from "../research/images/downscale.ts";
import { plannedWidths, THUMBNAIL_CONTENT_TYPES, THUMBNAIL_FORMATS, type ThumbnailFormat } from "./thumbnail-urls.ts";

/**
 * Rendering an image's thumbnails (`./thumbnail-urls.ts` says what they are
 * and how pages use them).
 *
 * **Resize only — never crop, pad or redraw.** The plate a tool photo sits on
 * shows it `object-fit: contain`, and product images are already trimmed to
 * the product with a small margin at approval (gateway spec §3.5), so every
 * photo keeps the visual weight it has at full size. A thumbnail is the same
 * picture with fewer pixels: aspect ratio, alpha and margins unchanged, EXIF
 * orientation applied, never enlarged.
 *
 * Plain Node: the bundled-photo script and the Blob backfill import it.
 */

/**
 * Bumped whenever the encoder settings change, so a re-run produces new
 * content-hashed names instead of reusing files made the old way.
 */
export const THUMBNAIL_VERSION = 1;

/** A decoded image larger than this (in pixels) is refused rather than resized. */
const MAX_INPUT_PIXELS = 60_000_000;

export interface Rendition {
  width: number;
  format: ThumbnailFormat;
  contentType: string;
  bytes: Uint8Array;
}

export interface RenderedThumbnails {
  /** The source's size after EXIF rotation. */
  width: number;
  height: number;
  widths: number[];
  renditions: Rendition[];
}

/**
 * A short, stable hash of the source bytes and the encoder version — the part
 * of a thumbnail's name that changes when either does.
 */
export function thumbnailHash(bytes: Uint8Array): string {
  return createHash("sha256").update(`thumbnails-v${THUMBNAIL_VERSION}:`).update(bytes).digest("hex").slice(0, 12);
}

/**
 * Every width × format of `bytes`, or null when `sharp` is unavailable or the
 * bytes are not an image it can decode.
 */
export async function renderThumbnails(
  bytes: Uint8Array,
  opts: { loadSharp?: SharpLoader } = {}
): Promise<RenderedThumbnails | null> {
  let sharp: Awaited<ReturnType<SharpLoader>>;
  try {
    sharp = await (opts.loadSharp ?? loadSharp)();
  } catch {
    return null;
  }
  if (!sharp) return null;

  try {
    const input = { failOn: "error" as const, limitInputPixels: MAX_INPUT_PIXELS };
    const meta = await sharp(bytes, input).metadata();
    if (!meta.width || !meta.height) return null;
    // Orientations 5–8 swap the axes once `.rotate()` applies them.
    const swapped = (meta.orientation ?? 1) >= 5;
    const width = swapped ? meta.height : meta.width;
    const height = swapped ? meta.width : meta.height;

    const widths = plannedWidths(width);
    const renditions: Rendition[] = [];
    for (const w of widths) {
      const resized = sharp(bytes, input).rotate().resize({ width: w, withoutEnlargement: true });
      for (const format of THUMBNAIL_FORMATS) {
        const encoded =
          format === "avif"
            ? resized.clone().avif({ quality: 55, effort: 4 })
            : resized.clone().webp({ quality: 78, alphaQuality: 90, effort: 4 });
        const out = await encoded.toBuffer();
        renditions.push({
          width: w,
          format,
          contentType: THUMBNAIL_CONTENT_TYPES[format],
          bytes: new Uint8Array(out.buffer, out.byteOffset, out.byteLength),
        });
      }
    }
    return { width, height, widths, renditions };
  } catch {
    return null;
  }
}
