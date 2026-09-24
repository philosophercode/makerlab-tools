import type { ImageFormat, ImageInfo } from "../../images/inspect.ts";

/**
 * Making a probed image small enough to hand a model (gateway spec §3.5 step 3:
 * "≤6 probed images (downscaled)"), and the one place `sharp` is loaded.
 *
 * A manufacturer's hero shot is often 3000 px and several megabytes; the
 * ranking model needs a 768 px look at it, and six full-size photos would make
 * one request tens of megabytes of base64. So each is re-encoded through
 * `sharp` as a JPEG with a long edge of at most 768 px, flattened onto white
 * (a transparent PNG would otherwise turn black).
 *
 * **`sharp` is loaded with a guarded `import()`**, once, by {@link loadSharp} —
 * which the background classifier and the cutout (`background.ts`,
 * `clean.ts`, through `pixels.ts`) use too. It resolves from `node_modules`
 * (Next's own dependency) and `next build` keeps it external. Every failure —
 * no package, no native binary, a file it cannot decode — falls back: ranking
 * uses the original bytes when they are at most 1.5 MB, and otherwise leaves
 * that image out of the model call (it is ranked after the ones the model
 * saw); classification answers "unknown" and no cutout is made.
 *
 * Plain Node: step code imports this.
 */

/** The ranking model's view of an image: its long edge, in pixels. */
export const RANK_IMAGE_LONG_EDGE = 768;

/** An image that could not be downscaled is sent to the ranking model as it is only up to this size. */
export const RANK_FALLBACK_MAX_BYTES = 1.5 * 1024 * 1024;

export interface ModelImage {
  bytes: Uint8Array;
  mediaType: ImageFormat;
}

type SharpFactory = typeof import("sharp");

/** How `sharp` is loaded — replaceable so a test can take it away. */
export type SharpLoader = () => Promise<SharpFactory | null>;

let loaded: Promise<SharpFactory | null> | null = null;

/** `sharp`, or null when this process cannot load it. Loaded once. */
export const loadSharp: SharpLoader = () => {
  loaded ??= import("sharp")
    .then((mod) => ((mod as { default?: SharpFactory }).default ?? (mod as unknown as SharpFactory)))
    .catch(() => null);
  return loaded;
};

/** The image as the ranking model sees it, or null when it cannot be sent at all. */
export async function downscaleForRanking(
  image: { bytes: Uint8Array; info: ImageInfo },
  opts: { loadSharp?: SharpLoader } = {}
): Promise<ModelImage | null> {
  const resized = await resizeToJpeg(image.bytes, RANK_IMAGE_LONG_EDGE, opts.loadSharp ?? loadSharp);
  if (resized) return resized;
  return image.bytes.byteLength <= RANK_FALLBACK_MAX_BYTES ? { bytes: image.bytes, mediaType: image.info.format } : null;
}

async function resizeToJpeg(bytes: Uint8Array, longEdge: number, load: SharpLoader): Promise<ModelImage | null> {
  let sharp: SharpFactory | null;
  try {
    sharp = await load();
  } catch {
    return null;
  }
  if (!sharp) return null;

  try {
    const out = await sharp(bytes, { failOn: "error", limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: longEdge, height: longEdge, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 82 })
      .toBuffer();
    return { bytes: new Uint8Array(out.buffer, out.byteOffset, out.byteLength), mediaType: "image/jpeg" };
  } catch {
    return null;
  }
}
