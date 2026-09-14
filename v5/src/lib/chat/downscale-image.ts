/**
 * Encode a photo small enough to send to the model (intake spec §6.1).
 *
 * A phone photo is several megabytes, and Claude scales anything past about
 * 1568px on the long edge down before reading it, so the extra pixels are only
 * request size and cost. Browser-only: it needs `createImageBitmap` and a canvas.
 */

/** The longest edge, in pixels, of the copy the model receives. */
export const VISION_MAX_EDGE = 1568;

const JPEG_QUALITY = 0.85;

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

/**
 * A downscaled JPEG `data:` URL of `file`, or null when the browser cannot
 * decode it (HEIC in most browsers, or no canvas at all). Null is a normal
 * answer: the photo still uploads to Notion, the model just does not see it.
 */
export async function downscaleForVision(file: Blob): Promise<string | null> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    return null;
  }

  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file);
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    // JPEG has no alpha: paint white first so a transparent screenshot does not
    // arrive as a black rectangle.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    return dataUrl.startsWith("data:image/") ? dataUrl : null;
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}
