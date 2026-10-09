import sharp, { type OverlayOptions } from "sharp";
import { getDocumentProxy, getResolvedPDFJS } from "unpdf";

/**
 * A scanned manual's pages as pictures, for OCR (manual text spec §9 phase 3).
 *
 * **No canvas.** pdf.js can only *render* a page onto a canvas, and the one
 * that works in Node (`@napi-rs/canvas`) is a native package the app does not
 * carry. A scan does not need a renderer, though: each page of one is a
 * picture — usually one image covering the page, sometimes a few strips — and
 * pdf.js already decodes those (JPEG, JBIG2, CCITT, Flate) in plain
 * JavaScript. So this walks each page's operator list, follows the graphics
 * state (`save`/`restore`, `transform`, form XObjects), takes every image it
 * paints with the matrix it is painted at, and composites them with `sharp`
 * (already a dependency, prebuilt binaries) onto a white page at the page's
 * own proportions and rotation.
 *
 * - **What is drawn is what is read.** Vector drawings and fonts are not
 *   drawn — a page with text has a text layer and never comes here — and an
 *   image painted at a skew (not a multiple of 90°) is left out.
 * - **Size.** The page is drawn at the resolution of its sharpest image,
 *   capped so its long side is at most {@link MAX_LONG_SIDE_PX} (what a vision
 *   model reads at full detail) and at least {@link MIN_LONG_SIDE_PX}; JPEG.
 * - A page that paints no image is `null`: there is nothing to read on it.
 *   One whose images could not be decoded (JPEG 2000, an image atlas) is
 *   `null` too, with `undrawn` counting them, so OCR can tell it from blank.
 * - pdf.js is opened as the extractor opens it (`isEvalSupported: false`, no
 *   font faces, errors-only logging); a page cap and a deadline checked
 *   between pages ({@link RENDER_TIMEOUT_MS}) bound the work.
 *
 * Plain Node: relative imports; the backfill runs it.
 */

export const MAX_LONG_SIDE_PX = 2000;
export const MIN_LONG_SIDE_PX = 1000;
const JPEG_QUALITY = 80;

/** Drawing a whole manual gives up after this long (checked between pages, as the extractor does). */
export const RENDER_TIMEOUT_MS = 180_000;

export interface PageImage {
  /** 1-based PDF page index — what `#page=N` opens. */
  pageNumber: number;
  /** The page as a JPEG, or null when it paints no image this can draw. */
  jpeg: Uint8Array | null;
  width: number;
  height: number;
  /**
   * Images the page paints that this could not draw (a JPEG 2000 scan pdf.js
   * cannot decode here, an image atlas, a kind it does not read). A page with
   * no JPEG and some of these is not blank — it could not be drawn — and OCR
   * counts it as failed rather than empty.
   */
  undrawn?: number;
}

export interface RenderedPages {
  pageCount: number;
  /** The pages drawn, in order: the first `maxPages` of the document. */
  pages: PageImage[];
  /** Printed page labels ("iv", "3-12") by 0-based index, when they differ from the page number. */
  labels: (string | null)[];
}

export interface RenderPageImagesOptions {
  /** Draw at most this many pages, from the first. */
  maxPages: number;
  timeoutMs?: number;
}

/** Draw the first `maxPages` pages of a scanned PDF. Throws when the file cannot be opened, or past the deadline. */
export async function renderPageImages(bytes: Uint8Array, options: RenderPageImagesOptions): Promise<RenderedPages> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes), {
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: 0,
  } as Parameters<typeof getDocumentProxy>[1]);
  try {
    const { OPS } = await getResolvedPDFJS();
    const pageCount = pdf.numPages;
    const pages: PageImage[] = [];
    const deadline = Date.now() + (options.timeoutMs ?? RENDER_TIMEOUT_MS);
    for (let n = 1; n <= Math.min(pageCount, options.maxPages); n += 1) {
      if (Date.now() > deadline) throw new Error("Drawing the pages took too long.");
      const page = await pdf.getPage(n);
      try {
        pages.push({ pageNumber: n, ...(await drawPage(page, OPS as unknown as OpsTable)) });
      } finally {
        page.cleanup();
      }
    }
    return { pageCount, pages, labels: await pageLabels(pdf, pageCount) };
  } finally {
    await pdf.loadingTask.destroy().catch(() => {});
  }
}

// ── One page ────────────────────────────────────────────────────────

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;
type PdfPage = Awaited<ReturnType<PdfDocument["getPage"]>>;
type OpsTable = Record<string, number>;

/** `[a b c d e f]`: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = [number, number, number, number, number, number];

/** The decoded samples of one image and the matrix it was painted at (unit square → device, at scale 1). */
export interface PlacedImage {
  width: number;
  height: number;
  channels: 1 | 3 | 4;
  data: Uint8Array;
  matrix: Matrix;
}

async function drawPage(page: PdfPage, OPS: OpsTable): Promise<Omit<PageImage, "pageNumber">> {
  const viewport = page.getViewport({ scale: 1 });
  const { placed, undrawn } = await collectImages(page, OPS, viewport.transform as Matrix);
  if (placed.length === 0) return { jpeg: null, width: 0, height: 0, undrawn };

  const scale = pageScale(viewport.width, viewport.height, placed);
  const width = Math.max(1, Math.round(viewport.width * scale));
  const height = Math.max(1, Math.round(viewport.height * scale));
  const layers: OverlayOptions[] = [];
  for (const image of placed) {
    const layer = await placeImage(image, scale, width, height);
    if (layer) layers.push(layer);
  }
  if (layers.length === 0) return { jpeg: null, width: 0, height: 0, undrawn: undrawn + placed.length };
  const jpeg = await sharp({ create: { width, height, channels: 3, background: "#ffffff" } })
    .composite(layers)
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
  return { jpeg: new Uint8Array(jpeg), width, height, undrawn: undrawn + placed.length - layers.length };
}

/**
 * Every image the page paints, with the device matrix it is painted at, and
 * how many it paints that could not be decoded. The graphics state is followed
 * through `save`/`restore`, `transform` and form XObjects (whose own matrix
 * applies inside them).
 */
async function collectImages(
  page: PdfPage,
  OPS: OpsTable,
  viewport: Matrix
): Promise<{ placed: PlacedImage[]; undrawn: number }> {
  const list = await page.getOperatorList();
  const placed: PlacedImage[] = [];
  let undrawn = 0;
  const stack: Matrix[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  for (let i = 0; i < list.fnArray.length; i += 1) {
    const fn = list.fnArray[i];
    const args = list.argsArray[i] as unknown[] | null;
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform && isMatrix(args)) ctm = multiply(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (isMatrix(args?.[0])) ctm = multiply(ctm, args[0]);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else {
      const paints = imagePaints(OPS, fn, args);
      if (paints === null) continue;
      if (paints === "unsupported") {
        undrawn += 1;
        continue;
      }
      for (const paint of paints) {
        const decoded = await decodeImage(page, paint.isMask, paint.image);
        if (decoded) placed.push({ ...decoded, matrix: multiply(viewport, multiply(ctm, paint.matrix)) });
        else undrawn += 1;
      }
    }
  }
  return { placed, undrawn };
}

/** One image painted by an operator: what to decode, and its matrix inside the current one. */
export interface ImagePaint {
  image: unknown;
  isMask: boolean;
  matrix: Matrix;
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/**
 * The images one operator paints, or null when it paints none. pdf.js's
 * operator-list optimiser folds runs of small or repeated images into group
 * and repeat operators; those are expanded here, one paint per position, with
 * the matrix the canvas renderer would apply (`canvas.js`). An image atlas
 * (`paintInlineImageXObjectGroup`) and a solid-colour mask are not drawn:
 * `"unsupported"`, so the page is not taken for blank.
 */
export function imagePaints(OPS: OpsTable, fn: number, args: unknown[] | null): ImagePaint[] | "unsupported" | null {
  const a = args ?? [];
  if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
    return [{ image: a[0], isMask: false, matrix: IDENTITY }];
  }
  if (fn === OPS.paintImageMaskXObject) return [{ image: a[0], isMask: true, matrix: IDENTITY }];
  if (fn === OPS.paintImageXObjectRepeat) {
    // [objId, scaleX, scaleY, positions]
    const [image, scaleX, scaleY, positions] = a as [unknown, number, number, ArrayLike<number>];
    return repeat(positions, (x, y) => ({ image, isMask: false, matrix: [scaleX, 0, 0, scaleY, x, y] }));
  }
  if (fn === OPS.paintImageMaskXObjectRepeat) {
    // [mask, scaleX, skewX, skewY, scaleY, positions]
    const [image, scaleX, skewX, skewY, scaleY, positions] = a as [unknown, number, number, number, number, ArrayLike<number>];
    return repeat(positions, (x, y) => ({ image, isMask: true, matrix: [scaleX, skewX ?? 0, skewY ?? 0, scaleY, x, y] }));
  }
  if (fn === OPS.paintImageMaskXObjectGroup) {
    // [[{ data, width, height, transform }, …]]
    const images = Array.isArray(a[0]) ? (a[0] as { transform?: unknown }[]) : [];
    return images.map((image) => ({ image, isMask: true, matrix: isMatrix(image?.transform) ? image.transform : IDENTITY }));
  }
  if (fn === OPS.paintInlineImageXObjectGroup || fn === OPS.paintSolidColorImageMask) return "unsupported";
  return null;
}

function repeat(positions: ArrayLike<number> | undefined, paint: (x: number, y: number) => ImagePaint): ImagePaint[] | "unsupported" {
  if (!positions || typeof positions.length !== "number") return "unsupported";
  const out: ImagePaint[] = [];
  for (let i = 0; i + 1 < positions.length; i += 2) out.push(paint(positions[i], positions[i + 1]));
  return out;
}

/** pdf.js's image kinds (`ImageKind`). */
const GRAYSCALE_1BPP = 1;
const RGB_24BPP = 2;
const RGBA_32BPP = 3;

interface PdfImageData {
  width?: number;
  height?: number;
  kind?: number;
  data?: Uint8Array | Uint8ClampedArray | string;
}

/** An image's samples as 8-bit grey, RGB or RGBA; null for a kind this cannot read (a bitmap, a skew). */
async function decodeImage(page: PdfPage, isMask: boolean, arg: unknown): Promise<Omit<PlacedImage, "matrix"> | null> {
  let image: PdfImageData | null = null;
  if (typeof arg === "string") image = await resolveObject(page, arg);
  else if (arg && typeof arg === "object") {
    const inline = arg as PdfImageData;
    // A mask's data is the key of the decoded mask; an inline image carries its samples.
    image = typeof inline.data === "string" ? { ...(await resolveObject(page, inline.data)), ...pick(inline) } : inline;
  }
  if (!image || !image.width || !image.height || !image.data || typeof image.data === "string") return null;
  const { width, height } = image;
  const data = image.data instanceof Uint8Array ? image.data : new Uint8Array(image.data);

  if (isMask) return { width, height, channels: 1, data: unpackBits(data, width, height) };
  if (image.kind === GRAYSCALE_1BPP) return { width, height, channels: 1, data: unpackBits(data, width, height) };
  if (image.kind === RGB_24BPP && data.length >= width * height * 3) return { width, height, channels: 3, data };
  if (image.kind === RGBA_32BPP && data.length >= width * height * 4) return { width, height, channels: 4, data };
  return null;
}

function pick(image: PdfImageData): PdfImageData {
  return { width: image.width, height: image.height };
}

/** A decoded object pdf.js keeps per page (`img_p0_1`) or per document (`g_…`). */
function resolveObject(page: PdfPage, key: string): Promise<PdfImageData | null> {
  const store = key.startsWith("g_") ? page.commonObjs : page.objs;
  return new Promise((resolve) => {
    try {
      store.get(key, (value: unknown) => resolve((value as PdfImageData) ?? null));
    } catch {
      resolve(null);
    }
  });
}

/**
 * One bit a pixel, rows padded to a byte, to one byte a pixel: a set bit is
 * white, a clear one black. That holds for both kinds pdf.js hands over — a
 * 1-bit image (1 is white) and a stencil mask (`/ImageMask`, where a clear bit
 * is where the ink goes).
 */
export function unpackBits(data: Uint8Array, width: number, height: number): Uint8Array {
  const rowBytes = Math.ceil(width / 8);
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
      out[y * width + x] = bit ? 255 : 0;
    }
  }
  return out;
}

// ── Placement ───────────────────────────────────────────────────────

/** Apply `inner` first, then `outer`. */
export function multiply(outer: Matrix, inner: Matrix): Matrix {
  const [a, b, c, d, e, f] = outer;
  const [a2, b2, c2, d2, e2, f2] = inner;
  return [a * a2 + c * b2, b * a2 + d * b2, a * c2 + c * d2, b * c2 + d * d2, a * e2 + c * f2 + e, b * e2 + d * f2 + f];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function isMatrix(value: unknown): value is Matrix {
  return Array.isArray(value) && value.length === 6 && value.every((n) => typeof n === "number" && Number.isFinite(n));
}

/**
 * Where an image lands, in device pixels at scale 1: its box, and the quarter
 * turns and mirror that put its pixels the right way up. The image's top-left
 * pixel sits at the unit square's (0, 1) — PDF images are stored top row first
 * and painted into a y-up square. Null when it is painted at a skew or has no
 * area.
 */
export function imageGeometry(
  matrix: Matrix
): { left: number; top: number; width: number; height: number; turns: 0 | 1 | 2 | 3; mirror: "flip" | "flop" | null } | null {
  const tl = apply(matrix, 0, 1);
  const tr = apply(matrix, 1, 1);
  const bl = apply(matrix, 0, 0);
  const xAxis = [tr[0] - tl[0], tr[1] - tl[1]];
  const down = [bl[0] - tl[0], bl[1] - tl[1]];
  const xLen = Math.hypot(xAxis[0], xAxis[1]);
  const downLen = Math.hypot(down[0], down[1]);
  if (xLen < 1e-6 || downLen < 1e-6) return null;
  const straight = (v: number[], len: number) => Math.abs(v[0]) / len < 0.01 || Math.abs(v[1]) / len < 0.01;
  if (!straight(xAxis, xLen) || !straight(down, downLen)) return null;

  // Device space is y-down, so a positive angle is a clockwise turn.
  const turns = (((Math.round(Math.atan2(xAxis[1], xAxis[0]) / (Math.PI / 2)) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
  const theta = (turns * Math.PI) / 2;
  // After the turn, the image's "down" points here; when the matrix says the
  // opposite, the picture is mirrored along that axis.
  const turnedDown = [-Math.sin(theta), Math.cos(theta)];
  const mirrored = turnedDown[0] * down[0] + turnedDown[1] * down[1] < 0;
  const mirror = mirrored ? (turns % 2 === 0 ? "flip" : "flop") : null;

  const br = [tl[0] + xAxis[0] + down[0], tl[1] + xAxis[1] + down[1]];
  const xs = [tl[0], tr[0], bl[0], br[0]];
  const ys = [tl[1], tr[1], bl[1], br[1]];
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top, turns, mirror };
}

/** The scale that draws the sharpest image at about its own resolution, within the long-side bounds. */
export function pageScale(pageWidth: number, pageHeight: number, images: readonly PlacedImage[]): number {
  let native = 1;
  for (const image of images) {
    const geometry = imageGeometry(image.matrix);
    if (!geometry) continue;
    const across = geometry.turns % 2 === 0 ? image.width : image.height;
    native = Math.max(native, across / Math.max(1, geometry.width));
  }
  const long = Math.max(pageWidth, pageHeight);
  return Math.min(MAX_LONG_SIDE_PX / long, Math.max(MIN_LONG_SIDE_PX / long, native));
}

/** One image, turned, mirrored and sized, as a layer cropped to the page; null when it falls off it. */
async function placeImage(
  image: PlacedImage,
  scale: number,
  pageWidth: number,
  pageHeight: number
): Promise<OverlayOptions | null> {
  const geometry = imageGeometry(image.matrix);
  if (!geometry) return null;
  const left = Math.round(geometry.left * scale);
  const top = Math.round(geometry.top * scale);
  const width = Math.max(1, Math.round(geometry.width * scale));
  const height = Math.max(1, Math.round(geometry.height * scale));

  const raw = { raw: { width: image.width, height: image.height, channels: image.channels } };
  // Separate pipelines: sharp mirrors before it rotates within one.
  const turned = await sharp(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength), raw)
    .rotate(geometry.turns * 90)
    .png()
    .toBuffer();
  let pipeline = sharp(turned);
  if (geometry.mirror === "flip") pipeline = pipeline.flip();
  if (geometry.mirror === "flop") pipeline = pipeline.flop();
  pipeline = pipeline.resize(width, height, { fit: "fill" }).flatten({ background: "#ffffff" });

  // Crop to the page: sharp refuses a layer that reaches past the base.
  const x0 = Math.max(0, left);
  const y0 = Math.max(0, top);
  const x1 = Math.min(pageWidth, left + width);
  const y1 = Math.min(pageHeight, top + height);
  if (x1 <= x0 || y1 <= y0) return null;
  const sized = await pipeline.png().toBuffer();
  const input =
    x0 === left && y0 === top && x1 === left + width && y1 === top + height
      ? sized
      : await sharp(sized)
          .extract({ left: x0 - left, top: y0 - top, width: x1 - x0, height: y1 - y0 })
          .png()
          .toBuffer();
  return { input, left: x0, top: y0 };
}

async function pageLabels(pdf: PdfDocument, pageCount: number): Promise<(string | null)[]> {
  let labels: string[] | null = null;
  try {
    labels = await pdf.getPageLabels();
  } catch {
    labels = null;
  }
  return Array.from({ length: pageCount }, (_, i) => {
    const label = labels?.[i]?.trim();
    return label && label !== String(i + 1) ? label.slice(0, 40) : null;
  });
}
