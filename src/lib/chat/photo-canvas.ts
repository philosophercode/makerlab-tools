/**
 * The browser's half of making a photo smaller: decode it once, draw it at a
 * size, encode the drawing. Native APIs only (`createImageBitmap`, a canvas),
 * so nothing is downloaded to do it.
 *
 * Browser-only. Every function answers null where the browser cannot do the
 * step, and never throws: the caller falls back to sending the original.
 */

/** An `OffscreenCanvas` where there is one (off the DOM), else a `<canvas>`. */
export type PhotoCanvas = OffscreenCanvas | HTMLCanvasElement;

type Context2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/**
 * Decode a picked file, upright. `imageOrientation: "from-image"` applies the
 * photo's EXIF orientation (a phone photo held upright is stored sideways with
 * a rotation tag); drawing the result then bakes the rotation into the pixels,
 * and the re-encoded copy needs no tag. JPEG, PNG and WebP decode everywhere;
 * HEIC/HEIF only in Safari (iOS, and macOS Safari 17+). Null when the browser
 * cannot read the file.
 */
export async function decodePhoto(file: Blob): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch (err) {
    // A browser that predates the option's `from-image` value rejects the
    // options as a TypeError; such a browser already applies EXIF orientation
    // by default, so ask again without them. Anything else is a decode failure.
    if (!(err instanceof TypeError)) return null;
    try {
      return await createImageBitmap(file);
    } catch {
      return null;
    }
  }
}

function makeCanvas(width: number, height: number): PhotoCanvas | null {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context2d(canvas: PhotoCanvas): Context2D | null {
  try {
    return canvas.getContext("2d") as Context2D | null;
  } catch {
    return null;
  }
}

/**
 * `bitmap` drawn at `size`. With a `background` the canvas is painted first —
 * white under a JPEG, so a transparent screenshot does not arrive as a black
 * rectangle; with none, transparency is kept for a PNG.
 */
export function drawScaled(
  bitmap: ImageBitmap,
  size: { width: number; height: number },
  background: string | null
): PhotoCanvas | null {
  const canvas = makeCanvas(size.width, size.height);
  if (!canvas) return null;
  const context = context2d(canvas);
  if (!context) return null;
  try {
    if (background) {
      context.fillStyle = background;
      context.fillRect(0, 0, size.width, size.height);
    }
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    return canvas;
  } catch {
    return null;
  }
}

/** Whether any pixel of the drawing is less than fully opaque. */
export function hasTransparency(canvas: PhotoCanvas): boolean {
  const context = context2d(canvas);
  if (!context) return false;
  try {
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** The drawing encoded as `type`, or null when the browser cannot encode it. */
export async function encodeCanvas(canvas: PhotoCanvas, type: string, quality?: number): Promise<Blob | null> {
  try {
    if ("convertToBlob" in canvas) {
      const blob = await canvas.convertToBlob({ type, quality });
      return blob.type === type ? blob : null;
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    // A browser that cannot write `type` hands back a PNG instead.
    return blob && blob.type === type ? blob : null;
  } catch {
    return null;
  }
}

/** A `data:` URL of `blob` — how the model is sent a photo. */
export function blobToDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const reader = new FileReader();
      reader.onload = () => {
        const url = typeof reader.result === "string" ? reader.result : "";
        resolve(url.startsWith("data:image/") ? url : null);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    } catch {
      resolve(null);
    }
  });
}
