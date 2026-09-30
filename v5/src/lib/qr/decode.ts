import "server-only";

import jsQR from "jsqr";
import { loadRgba, type RgbaImage } from "../research/images/pixels";

/**
 * Reading QR codes out of a photo on the server (QR labels amendment, "codes
 * in chat photos"), with `jsqr` — pure JavaScript, so it runs wherever the
 * chat route runs — over pixels `sharp` decodes (`loadRgba`: EXIF-rotated,
 * shrunk, never enlarged).
 *
 * A phone photo of a label is usually big and the code a small part of it, so
 * the image is tried at a few sizes ({@link QR_DECODE_SIZES}); a label is dark
 * on light, so the inverted image is tried only on the last pass. Each pass
 * is tens of milliseconds on a phone photo; the passes stop at the first code
 * found or when the time budget is spent, and a very large file is skipped.
 * **Never throws**: a photo that cannot be read has no codes.
 */

export interface DecodeOptions {
  /** Wall-clock budget for one image, in ms. A pass already running finishes. */
  budgetMs?: number;
  /** Files larger than this are not decoded at all. */
  maxBytes?: number;
  /** The long edges tried, in order. */
  sizes?: readonly number[];
  /** Replaceable for tests. */
  toRgba?: (bytes: Uint8Array, longEdge: number) => Promise<RgbaImage | null>;
  now?: () => number;
}

export const QR_DECODE_BUDGET_MS = 1500;
export const QR_DECODE_MAX_BYTES = 15 * 1024 * 1024;
/** The long edges tried: a 1600 px view first (fast, and a label's modules resolve), a 1000 px one for a big soft code, 2400 px for a small far one. */
export const QR_DECODE_SIZES = [1600, 1000, 2400] as const;

export async function decodeQrCodes(bytes: Uint8Array, options: DecodeOptions = {}): Promise<string[]> {
  const {
    budgetMs = QR_DECODE_BUDGET_MS,
    maxBytes = QR_DECODE_MAX_BYTES,
    sizes = QR_DECODE_SIZES,
    toRgba = (input, edge) => loadRgba(input, edge),
    now = Date.now,
  } = options;
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) return [];
  const started = now();
  let lastWidth = 0;
  try {
    for (const [pass, size] of sizes.entries()) {
      if (now() - started > budgetMs) break;
      const image = await toRgba(bytes, size);
      if (!image) return [];
      // `withoutEnlargement`: a small image comes back the same size every time.
      if (image.width === lastWidth) continue;
      lastWidth = image.width;
      const code = jsQR(new Uint8ClampedArray(image.data.buffer, image.data.byteOffset, image.data.byteLength), image.width, image.height, {
        inversionAttempts: pass === sizes.length - 1 ? "attemptBoth" : "dontInvert",
      });
      if (code?.data) return [code.data];
    }
  } catch (error) {
    console.warn("[qr] decode failed", (error as Error)?.message ?? error);
  }
  return [];
}

/** A `data:` URL's bytes, or null for anything else (a remote URL is never fetched here). */
export function dataUrlBytes(dataUrl: string | undefined): Uint8Array | null {
  const match = /^data:[^;,]*;base64,([\s\S]*)$/.exec(dataUrl ?? "");
  if (!match) return null;
  try {
    return new Uint8Array(Buffer.from(match[1], "base64"));
  } catch {
    return null;
  }
}
