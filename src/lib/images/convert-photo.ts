import { loadSharp, type SharpLoader } from "../research/images/downscale.ts";
import { decodeHeif, type HeifDecoderLoader } from "./heif.ts";
import { PHOTO_JPEG_QUALITY, PHOTO_UPLOAD_MAX_EDGE, VISION_MAX_EDGE } from "./photo-rules.ts";

/**
 * A HEIC photo the browser could not read, made into what the browser would
 * have uploaded (data platform spec amendment 2026-10-08): a JPEG at most
 * 2048 px on the long edge, quality 85, flattened onto white, with no
 * metadata — and, for the chat, the 1568 px JPEG the model sees, as a `data:`
 * URL. The same rules as the browser's (`photo-rules.ts`), so storage, the
 * admin's view and the model all get a JPEG whichever side converted it.
 *
 * libheif decodes (`heif.ts`); `sharp` resizes and encodes from the raw pixels.
 *
 * Plain Node: relative imports only.
 */

export interface ConvertedPhoto {
  /** The JPEG to store. */
  bytes: Uint8Array;
  type: "image/jpeg";
  width: number;
  height: number;
  /** The model's copy, when asked for. */
  visionDataUrl: string | null;
}

export async function convertHeifPhoto(
  bytes: Uint8Array,
  opts: { vision: boolean; loadDecoder?: HeifDecoderLoader; loadSharp?: SharpLoader }
): Promise<ConvertedPhoto | null> {
  const pixels = await decodeHeif(bytes, { load: opts.loadDecoder });
  if (!pixels) return null;

  let sharp: Awaited<ReturnType<SharpLoader>>;
  try {
    sharp = await (opts.loadSharp ?? loadSharp)();
  } catch {
    return null;
  }
  if (!sharp) return null;

  const quality = Math.round(PHOTO_JPEG_QUALITY * 100);
  const raw = Buffer.from(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength);
  const source = sharp(raw, { raw: { width: pixels.width, height: pixels.height, channels: 4 } });
  const jpegAt = (maxEdge: number) =>
    source
      .clone()
      .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality })
      .toBuffer({ resolveWithObject: true });

  try {
    const stored = await jpegAt(PHOTO_UPLOAD_MAX_EDGE);
    const vision = opts.vision ? await jpegAt(VISION_MAX_EDGE) : null;
    return {
      bytes: new Uint8Array(stored.data.buffer, stored.data.byteOffset, stored.data.byteLength),
      type: "image/jpeg",
      width: stored.info.width,
      height: stored.info.height,
      visionDataUrl: vision ? `data:image/jpeg;base64,${vision.data.toString("base64")}` : null,
    };
  } catch (err) {
    console.warn("[convert-photo] encode failed:", err instanceof Error ? err.message.slice(0, 200) : "unknown error");
    return null;
  }
}
