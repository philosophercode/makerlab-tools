import sharp from "sharp";

/**
 * Synthetic product photos for the background classifier and the cutout
 * (`src/lib/research/images/background.ts`, `clean.ts`): an RGBA canvas you
 * paint with rectangles and a per-pixel function, encoded by `sharp` as PNG or
 * JPEG. No network, no fixtures on disk.
 */

export type Rgba = [number, number, number, number];

export class Canvas {
  readonly data: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    fill: Rgba = [255, 255, 255, 255]
  ) {
    this.data = new Uint8Array(width * height * 4);
    this.paint(() => fill);
  }

  /** Set every pixel to `colour(x, y)`. */
  paint(colour: (x: number, y: number) => Rgba): this {
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) this.set(x, y, colour(x, y));
    }
    return this;
  }

  /** Fill the rectangle [left, left + w) × [top, top + h). */
  rect(left: number, top: number, w: number, h: number, colour: Rgba): this {
    for (let y = top; y < top + h; y += 1) {
      for (let x = left; x < left + w; x += 1) this.set(x, y, colour);
    }
    return this;
  }

  set(x: number, y: number, [r, g, b, a]: Rgba): void {
    const p = (y * this.width + x) * 4;
    this.data[p] = r;
    this.data[p + 1] = g;
    this.data[p + 2] = b;
    this.data[p + 3] = a;
  }

  get(x: number, y: number): Rgba {
    const p = (y * this.width + x) * 4;
    return [this.data[p], this.data[p + 1], this.data[p + 2], this.data[p + 3]];
  }

  async png(opts: { alpha?: boolean } = {}): Promise<Uint8Array> {
    let image = sharp(this.data, { raw: { width: this.width, height: this.height, channels: 4 } });
    if (!opts.alpha) image = image.removeAlpha();
    return toBytes(await image.png().toBuffer());
  }

  async jpeg(quality = 75): Promise<Uint8Array> {
    const image = sharp(this.data, { raw: { width: this.width, height: this.height, channels: 4 } }).removeAlpha();
    return toBytes(await image.jpeg({ quality }).toBuffer());
  }
}

/** Decode any image to RGBA pixels, as the cutout sees it. */
export async function decode(bytes: Uint8Array): Promise<{ data: Uint8Array; width: number; height: number }> {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: toBytes(data), width: info.width, height: info.height };
}

/** A deterministic pseudo-random stream in [0, 1). */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function toBytes(buffer: Buffer): Uint8Array {
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}
