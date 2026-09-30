import { loadSharp, type SharpLoader } from "./downscale.ts";

/**
 * An image as raw RGBA pixels, for the background classifier and the cutout
 * (`background.ts`, `clean.ts`) — decoded by `sharp`, EXIF-rotated, and shrunk
 * so its long edge is at most `longEdge` (never enlarged). An image without an
 * alpha channel gets an opaque one, so every pixel is four bytes.
 *
 * Null when `sharp` cannot be loaded or the bytes do not decode: both callers
 * treat that as "cannot tell", never as a failure of the item.
 *
 * Plain Node: step code imports this.
 */

export interface RgbaImage {
  /** `width * height * 4` bytes, row-major, R G B A. */
  data: Uint8Array;
  width: number;
  height: number;
}

/** The decoder's pixel ceiling, as for ranking: a bomb is refused, not decoded. */
const MAX_INPUT_PIXELS = 50_000_000;

export async function loadRgba(
  bytes: Uint8Array,
  longEdge: number,
  load: SharpLoader = loadSharp
): Promise<RgbaImage | null> {
  let sharp: Awaited<ReturnType<SharpLoader>>;
  try {
    sharp = await load();
  } catch {
    return null;
  }
  if (!sharp) return null;

  try {
    const { data, info } = await sharp(bytes, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width: longEdge, height: longEdge, fit: "inside", withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.channels !== 4) return null;
    return {
      data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      width: info.width,
      height: info.height,
    };
  } catch {
    return null;
  }
}

/** Euclidean distance between two RGB colours, 0–441. */
export function colourDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** How wide the border band is: about 1% of the short edge, 2–6 px. */
export function borderBand(width: number, height: number): number {
  return Math.max(2, Math.min(6, Math.round(Math.min(width, height) / 100)));
}

/** Calls `visit(index)` for every pixel in the `band`-wide frame around the edge, each once. */
export function forEachBorderPixel(width: number, height: number, band: number, visit: (index: number) => void): void {
  const b = Math.min(band, Math.ceil(width / 2), Math.ceil(height / 2));
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    if (y < b || y >= height - b) {
      for (let x = 0; x < width; x += 1) visit(row + x);
      continue;
    }
    for (let x = 0; x < b; x += 1) visit(row + x);
    for (let x = Math.max(b, width - b); x < width; x += 1) visit(row + x);
  }
}

/** The per-channel median of `samples` (pixel indexes into `data`). */
export function medianColour(data: Uint8Array, samples: readonly number[]): [number, number, number] {
  const channel = (offset: number) => {
    const histogram = new Uint32Array(256);
    for (const i of samples) histogram[data[i * 4 + offset]] += 1;
    const half = samples.length / 2;
    let seen = 0;
    for (let v = 0; v < 256; v += 1) {
      seen += histogram[v];
      if (seen >= half) return v;
    }
    return 255;
  };
  return [channel(0), channel(1), channel(2)];
}

/** Rec. 601 luma, 0–255. */
export function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}
