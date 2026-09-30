import sharp from "sharp";
import { toBuffer } from "qrcode";

/**
 * Photo-like fixtures for the QR decoder (QR labels amendment): a real code
 * made by `qrcode`, then placed the way a phone sees a label — small in a big
 * frame, turned, on a busy background, softened — with `sharp`. Deterministic
 * (a seeded noise field), no files on disk.
 */

function seededNoise(width: number, height: number, seed = 7): Buffer {
  const data = Buffer.alloc(width * height * 3);
  let state = seed;
  for (let index = 0; index < data.length; index += 3) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    // Mid-tone clutter: a workshop wall, not a white page.
    const base = 90 + (state % 110);
    data[index] = base;
    data[index + 1] = (base + (state >> 8)) % 200 + 30;
    data[index + 2] = (base + (state >> 16)) % 180 + 40;
  }
  return data;
}

/** A plain code, `size` px square, black on white with its quiet zone. */
export async function qrPng(text: string, size = 400): Promise<Buffer> {
  return toBuffer(text, { type: "png", width: size, margin: 4, errorCorrectionLevel: "H" });
}

export interface PhotoOptions {
  /** The frame, as a phone photo. */
  width?: number;
  height?: number;
  /** The code's edge in the frame. */
  codeSize?: number;
  /** Turned by this many degrees. */
  rotate?: number;
  /** Gaussian blur sigma, for a soft focus. */
  blur?: number;
  /** Where the code's top-left sits. */
  left?: number;
  top?: number;
}

/** A code placed in a noisy photo-sized frame, turned and softened, as a JPEG. */
export async function qrPhoto(text: string, options: PhotoOptions = {}): Promise<Buffer> {
  const { width = 3000, height = 2250, codeSize = 420, rotate = 0, blur = 0, left = 1100, top = 800 } = options;
  let code = sharp(await qrPng(text, codeSize));
  if (rotate) code = code.rotate(rotate, { background: "#ffffff" });
  const placed = await code.png().toBuffer();
  // The clutter is softened first — a real wall has texture, not per-pixel
  // static — and the photo's own grain is added back by the JPEG.
  const wall = await sharp(seededNoise(width, height), { raw: { width, height, channels: 3 } }).blur(4).png().toBuffer();
  let photo = sharp(wall).composite([{ input: placed, left, top }]);
  if (blur) photo = sharp(await photo.png().toBuffer()).blur(blur);
  return photo.jpeg({ quality: 82 }).toBuffer();
}

/** A photo with no code in it. */
export async function plainPhoto(width = 2000, height = 1500): Promise<Buffer> {
  return sharp(seededNoise(width, height, 99), { raw: { width, height, channels: 3 } }).jpeg({ quality: 82 }).toBuffer();
}
