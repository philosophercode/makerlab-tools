import {
  ORIGINAL_UPLOAD_MAX_BYTES,
  PHOTO_JPEG_QUALITY,
  PHOTO_UPLOAD_MAX_EDGE,
  PICKED_PHOTO_MAX_BYTES,
  PNG_KEEP_MAX_BYTES,
  VISION_MAX_EDGE,
  fitWithin,
  heifTypeForName,
  mayHaveAlpha,
  photoUploadName,
  uploadFormatFor,
  type PhotoUploadType,
} from "../images/photo-rules.ts";
import { blobToDataUrl, decodePhoto, drawScaled, encodeCanvas, hasTransparency } from "./photo-canvas.ts";

/**
 * Turn a picked photo into what the chat uploads (data platform spec amendment
 * 2026-10-08, "Photos from any phone").
 *
 * A phone photo is several megabytes and often HEIC. Where the browser can read
 * it, it is decoded once and drawn twice: a copy at most 2048 px on the long
 * edge is **uploaded instead of the original** — JPEG, or PNG for a small one
 * with transparency — and a 1568 px JPEG is what the model sees (intake spec
 * §6.1). Re-encoding drops the EXIF block, GPS position included, after the
 * orientation it carried has been applied to the pixels.
 *
 * Where it cannot (HEIC outside Safari), the original is uploaded as it is, and
 * `POST /api/uploads` converts it to the same JPEG and answers with the model's
 * copy. A photo too large for either path is refused here, before any upload.
 *
 * (Until then this module made only the model's copy, and the original went up
 * as picked — several megabytes, EXIF and all, and refused outright as HEIC.)
 *
 * Browser-only.
 */

export type PreparedPhoto =
  /** Downsized here: upload `upload`; `visionDataUrl` is the model's copy (null if it could not be encoded). */
  | { kind: "ready"; upload: File; visionDataUrl: string | null }
  /** The browser could not read it: upload the original, which the server converts. */
  | { kind: "original"; upload: File }
  /** Over {@link PICKED_PHOTO_MAX_BYTES}, or unreadable here and over {@link ORIGINAL_UPLOAD_MAX_BYTES}. */
  | { kind: "tooLarge" };

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (file.size > PICKED_PHOTO_MAX_BYTES) return { kind: "tooLarge" };

  const bitmap = await decodePhoto(file);
  if (!bitmap) return asOriginal(file);
  try {
    const ready = await downsize(bitmap, sourceTypeOf(file), file.name);
    return ready ?? asOriginal(file);
  } finally {
    bitmap.close();
  }
}

/** The original as it was picked, typed when the browser left it untyped (`.heic` on Windows). */
function asOriginal(file: File): PreparedPhoto {
  if (file.size > ORIGINAL_UPLOAD_MAX_BYTES) return { kind: "tooLarge" };
  const heifType = heifTypeForName(file.name);
  const untyped = !file.type || file.type === "application/octet-stream";
  const upload =
    heifType && untyped ? new File([file], file.name, { type: heifType, lastModified: file.lastModified }) : file;
  return { kind: "original", upload };
}

function sourceTypeOf(file: File): string {
  return file.type || heifTypeForName(file.name) || "";
}

async function downsize(bitmap: ImageBitmap, sourceType: string, name: string): Promise<PreparedPhoto | null> {
  const size = fitWithin(bitmap.width, bitmap.height, PHOTO_UPLOAD_MAX_EDGE);
  if (size.width <= 0 || size.height <= 0) return null;

  const stored = await encodeStored(bitmap, size, sourceType);
  if (!stored) return null;
  const upload = new File([stored.blob], photoUploadName(name, stored.type), { type: stored.type });

  // The model's copy: the stored JPEG itself when it is already small enough,
  // else drawn again from the same decoded bitmap — never decoded twice.
  const visionSize = fitWithin(bitmap.width, bitmap.height, VISION_MAX_EDGE);
  const sameAsStored = stored.type === "image/jpeg" && visionSize.width === size.width && visionSize.height === size.height;
  const visionBlob = sameAsStored ? stored.blob : await encodeJpeg(bitmap, visionSize);
  const visionDataUrl = visionBlob ? await blobToDataUrl(visionBlob) : null;

  return { kind: "ready", upload, visionDataUrl };
}

/** The copy that is stored: a PNG for a small one with transparency, else a JPEG on white. */
async function encodeStored(
  bitmap: ImageBitmap,
  size: { width: number; height: number },
  sourceType: string
): Promise<{ blob: Blob; type: PhotoUploadType } | null> {
  if (mayHaveAlpha(sourceType)) {
    const canvas = drawScaled(bitmap, size, null);
    if (!canvas) return null;
    if (uploadFormatFor({ sourceType, hasAlpha: hasTransparency(canvas) }) === "image/png") {
      const png = await encodeCanvas(canvas, "image/png");
      if (png && png.size <= PNG_KEEP_MAX_BYTES) return { blob: png, type: "image/png" };
    }
  }
  const jpeg = await encodeJpeg(bitmap, size);
  return jpeg ? { blob: jpeg, type: "image/jpeg" } : null;
}

async function encodeJpeg(bitmap: ImageBitmap, size: { width: number; height: number }): Promise<Blob | null> {
  // JPEG has no alpha: paint white first so a transparent screenshot does not
  // arrive as a black rectangle.
  const canvas = drawScaled(bitmap, size, "#ffffff");
  return canvas ? encodeCanvas(canvas, "image/jpeg", PHOTO_JPEG_QUALITY) : null;
}
