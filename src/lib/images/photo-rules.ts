/**
 * The rules for a photo someone attaches — its size, its format and what the
 * picker offers (data platform spec amendment 2026-10-08, "Photos from any
 * phone"). Shared by the browser, which downsizes a photo before it uploads,
 * and by `POST /api/uploads`, which converts the HEIC photos a browser could
 * not read. Both make the same copy, so the stored photo and the model's view
 * of it do not depend on which side did the work.
 *
 * Pure and client-safe. Plain Node: relative imports only.
 */

/** The longest edge, in pixels, of the photo that is stored. */
export const PHOTO_UPLOAD_MAX_EDGE = 2048;

/**
 * The longest edge, in pixels, of the copy the model receives. The provider
 * scales anything past about 1568 px down before reading it, so more pixels
 * are only request size and cost (intake spec §6.1).
 */
export const VISION_MAX_EDGE = 1568;

/** JPEG quality for both copies, as the 0–1 a canvas takes. */
export const PHOTO_JPEG_QUALITY = 0.85;

/**
 * A PNG with transparency stays a PNG only while its downsized copy is at most
 * this size; a larger one (a big transparent render) becomes a JPEG on white.
 */
export const PNG_KEEP_MAX_BYTES = 1.5 * 1024 * 1024;

/** The largest photo the browser will try to read at all. */
export const PICKED_PHOTO_MAX_BYTES = 25 * 1024 * 1024;

/**
 * The largest photo sent as it is, when the browser could not read it (HEIC
 * outside Safari). A Vercel function refuses a request body over 4.5 MB before
 * the route runs, so this leaves room for the multipart framing.
 */
export const ORIGINAL_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

/**
 * What a photo picker offers: JPEG, PNG and WebP everywhere, and HEIC/HEIF by
 * type and by extension, because Windows and some Android pickers know an
 * iPhone photo only by its `.heic` name. No `capture` attribute anywhere: a
 * phone then offers both the camera and the photo library.
 */
export const PHOTO_ACCEPT = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  ".heic",
  ".heif",
] as const;

export type PhotoUploadType = "image/jpeg" | "image/png";

/** Scale `width` × `height` to fit within `maxEdge`, never enlarging. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number = VISION_MAX_EDGE
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= 0 || longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** The HEIC/HEIF type a file name implies, or null when it names neither. */
export function heifTypeForName(name: string | null | undefined): "image/heic" | "image/heif" | null {
  const match = /\.(heic|heif)$/i.exec(name ?? "");
  if (!match) return null;
  return match[1].toLowerCase() === "heic" ? "image/heic" : "image/heif";
}

/**
 * Whether a picked file is a photo: its type says image, or — when the browser
 * gave it no useful type, as Chrome on Windows does for `.heic` — its name
 * says HEIC or HEIF.
 */
export function isPhotoFile(file: { type: string; name: string }): boolean {
  if (file.type.startsWith("image/")) return true;
  const untyped = !file.type || file.type === "application/octet-stream";
  return untyped && heifTypeForName(file.name) !== null;
}

/** Whether a source format can carry transparency worth checking for. */
export function mayHaveAlpha(sourceType: string): boolean {
  return sourceType === "image/png" || sourceType === "image/webp" || sourceType === "image/gif";
}

/**
 * The format a downsized photo is stored in: PNG only for a source that has
 * transparency, so a cut-out keeps it; JPEG for everything else, photos and
 * opaque screenshots alike. The caller still drops a PNG that comes out larger
 * than {@link PNG_KEEP_MAX_BYTES} to JPEG.
 */
export function uploadFormatFor(source: { sourceType: string; hasAlpha: boolean }): PhotoUploadType {
  return source.hasAlpha && mayHaveAlpha(source.sourceType) ? "image/png" : "image/jpeg";
}

/**
 * The name a converted photo is uploaded under: the picked name's stem with
 * the extension of what it now is (`IMG_0412.HEIC` → `IMG_0412.jpg`), so the
 * stored file's name and type agree.
 */
export function photoUploadName(name: string | null | undefined, type: PhotoUploadType): string {
  const stem = (name ?? "").replace(/\.[a-z0-9]{1,5}$/i, "").trim() || "photo";
  return `${stem}.${type === "image/png" ? "png" : "jpg"}`;
}
