import { inspectImage, type ImageInfo } from "../../images/inspect.ts";
import type { CleanNote } from "../result.ts";
import { classifyPixels } from "./background.ts";
import { loadSharp, type SharpLoader } from "./downscale.ts";
import { borderBand, colourDistance, forEachBorderPixel, loadRgba, medianColour, type RgbaImage } from "./pixels.ts";

/**
 * Step 4 of the image stage: the background-removed copy of rank 1, made by a
 * **deterministic cutout** — never a generative redraw (gateway spec,
 * amendment "No generative redraw: deterministic cutout"). Only a candidate
 * `background.ts` classified `plain` is cut (and the working copy is
 * classified again before cutting); every pixel that is kept is the original's
 * pixel, so a label reads exactly as it did.
 *
 * 1. **Flood fill from the frame.** The backdrop colour is the median of the
 *    border band. Every border pixel within {@link FILL_TOLERANCE} of it seeds
 *    a 4-connected fill, which spreads into a neighbour that is within
 *    {@link FILL_TOLERANCE} of the backdrop — or, to follow a soft gradient or
 *    shadow, within {@link FILL_STEP_TOLERANCE} of the pixel it came from and
 *    never more than {@link FILL_MAX_DRIFT} from the backdrop. A product edge is
 *    a jump bigger than a step, so the fill stops there. Only what is
 *    **connected to the frame** becomes transparent: a white panel enclosed by
 *    the product stays.
 * 2. **Specks go.** A foreground island smaller than {@link SPECK_SHARE} of the
 *    frame is backdrop noise (JPEG blocks), and joins the backdrop.
 * 3. **Validated, or dropped** ({@link validateCutout}) — a cut that removed
 *    less than {@link MIN_REMOVED_SHARE} (there was no backdrop) or more than
 *    {@link MAX_REMOVED_SHARE} (it ate the product), that leaves more than
 *    {@link MAX_LARGE_PIECES} large pieces, or whose product box is tiny, is
 *    not kept. The reason is a {@link CleanNote}; the admin sees the originals.
 * 4. **Feathered and trimmed.** The two pixel rings of the product nearest the
 *    cut get a short alpha ramp (softened further where their colour is close
 *    to the backdrop, which is what a halo is); RGB is untouched. The result is
 *    trimmed to the product's box plus a small margin and encoded as PNG.
 *
 * Works on a copy at most {@link CUTOUT_LONG_EDGE} px long — a cover, not a
 * print. Never throws: a failure is `{ ok: false, note }`.
 *
 * Plain Node: step code imports this.
 */

/** The cutout's working and output size (long edge, px). */
export const CUTOUT_LONG_EDGE = 1024;

/** RGB distance from the backdrop median that is backdrop outright. */
export const FILL_TOLERANCE = 40;
/** RGB distance from the neighbour it came from that a gradient-following step may take. */
export const FILL_STEP_TOLERANCE = 10;
/** Gradient following never reaches a pixel further than this from the backdrop median. */
export const FILL_MAX_DRIFT = 72;

/** A foreground island smaller than this share of the frame is noise. */
export const SPECK_SHARE = 0.0005;
/** A cut that removed less than this share found no backdrop worth removing. */
export const MIN_REMOVED_SHARE = 0.15;
/** A cut that removed more than this share took the product with it. */
export const MAX_REMOVED_SHARE = 0.92;
/** A foreground piece at least this share of the frame is "large". */
export const LARGE_PIECE_SHARE = 0.01;
/** More large pieces than this and the product fell apart. */
export const MAX_LARGE_PIECES = 4;
/** The product's box must cover at least this share of the frame… */
export const MIN_PRODUCT_BOX_SHARE = 0.04;
/** …and span at least this share of each side. */
export const MIN_PRODUCT_SIDE_SHARE = 0.1;

/** The feather: alpha of the product's outermost ring, then the next. */
export const FEATHER_ALPHA = [160, 224] as const;

/**
 * Inside the product box the ranking model drew (when the caller passes one),
 * the fill takes only a pixel this close to the backdrop, and follows no
 * gradient — so a white base or panel a shade off the backdrop (240 on 254)
 * is kept, not eaten along with the floor.
 */
export const PROTECTED_FILL_TOLERANCE = 12;

/** Alpha below this is see-through (an already-transparent pixel the fill may cross). */
const CLEAR_ALPHA = 16;

export interface CleanedImage {
  bytes: Uint8Array;
  info: ImageInfo;
  /** Where the trimmed result sits in the working-size image — for tests and diagnostics. */
  crop: { left: number; top: number; width: number; height: number };
}

export type CleanOutcome = { ok: true; image: CleanedImage } | { ok: false; note: CleanNote };

/** The fill's verdict for every pixel, before feathering. */
export interface Cutout {
  /** 1 = backdrop (becomes transparent), 0 = product. */
  backdrop: Uint8Array;
  /** The backdrop colour the fill measured against. */
  backdropColour: [number, number, number];
  removedShare: number;
  largePieces: number;
  /** The product's bounding box (inclusive), or null when nothing is left. */
  box: { left: number; top: number; right: number; bottom: number } | null;
}

/** Cut the backdrop out of `bytes`. Never throws. */
export async function cleanImage(
  bytes: Uint8Array,
  opts: {
    loadSharp?: SharpLoader;
    /** Where the product is, `[x0, y0, x1, y1]` normalised to 0–1: filled with {@link PROTECTED_FILL_TOLERANCE}. */
    protect?: readonly [number, number, number, number];
  } = {}
): Promise<CleanOutcome> {
  const load = opts.loadSharp ?? loadSharp;
  const image = await loadRgba(bytes, CUTOUT_LONG_EDGE, load);
  if (!image) return { ok: false, note: "failed" };
  // The caller classified a smaller copy; this is the one being cut.
  if (classifyPixels(image) !== "plain") return { ok: false, note: "busy_background" };

  const protect = opts.protect
    ? {
        left: Math.floor(opts.protect[0] * image.width),
        top: Math.floor(opts.protect[1] * image.height),
        right: Math.ceil(opts.protect[2] * image.width) - 1,
        bottom: Math.ceil(opts.protect[3] * image.height) - 1,
      }
    : undefined;
  const cutout = floodFillCutout(image, { protect });
  const rejected = validateCutout(cutout, image.width, image.height);
  if (rejected) return { ok: false, note: rejected };

  const encoded = await encodeCutout(image, cutout, load);
  return encoded ? { ok: true, image: encoded } : { ok: false, note: "failed" };
}

/** Steps 1 and 2: which pixels are backdrop, and what is left. Pure. */
export function floodFillCutout(
  { data, width, height }: RgbaImage,
  opts: { protect?: { left: number; top: number; right: number; bottom: number } } = {}
): Cutout {
  const n = width * height;
  const border: number[] = [];
  forEachBorderPixel(width, height, borderBand(width, height), (i) => {
    if (data[i * 4 + 3] >= CLEAR_ALPHA) border.push(i);
  });
  const [br, bg, bb] = border.length > 0 ? medianColour(data, border) : [255, 255, 255];
  const drift = (i: number) => colourDistance(data[i * 4], data[i * 4 + 1], data[i * 4 + 2], br, bg, bb);
  const { protect } = opts;
  const guarded = (i: number) => {
    if (!protect) return false;
    const x = i % width;
    const y = (i - x) / width;
    return x >= protect.left && x <= protect.right && y >= protect.top && y <= protect.bottom;
  };

  const backdrop = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;

  // Seeds: every pixel of the outermost ring that looks like the backdrop.
  const seed = (i: number) => {
    if (backdrop[i]) return;
    if (data[i * 4 + 3] < CLEAR_ALPHA || drift(i) <= (guarded(i) ? PROTECTED_FILL_TOLERANCE : FILL_TOLERANCE)) {
      backdrop[i] = 1;
      queue[tail++] = i;
    }
  };
  forEachBorderPixel(width, height, 1, seed);

  const accept = (from: number, to: number) => {
    if (backdrop[to]) return;
    const p = to * 4;
    let take = data[p + 3] < CLEAR_ALPHA;
    if (!take && guarded(to)) {
      take = drift(to) <= PROTECTED_FILL_TOLERANCE;
    } else if (!take) {
      const d = drift(to);
      if (d <= FILL_TOLERANCE) take = true;
      else if (d <= FILL_MAX_DRIFT) {
        const q = from * 4;
        take = colourDistance(data[p], data[p + 1], data[p + 2], data[q], data[q + 1], data[q + 2]) <= FILL_STEP_TOLERANCE;
      }
    }
    if (take) {
      backdrop[to] = 1;
      queue[tail++] = to;
    }
  };

  while (head < tail) {
    const i = queue[head++];
    const x = i % width;
    if (x > 0) accept(i, i - 1);
    if (x < width - 1) accept(i, i + 1);
    if (i >= width) accept(i, i - width);
    if (i < n - width) accept(i, i + width);
  }

  const { largePieces, box, removed } = sweepPieces(backdrop, width, height);
  return { backdrop, backdropColour: [br, bg, bb], removedShare: removed / n, largePieces, box };
}

/** Step 3: why this cut must not be kept, or null when it may. */
export function validateCutout(cutout: Cutout, width: number, height: number): CleanNote | null {
  if (cutout.removedShare < MIN_REMOVED_SHARE) return "little_background";
  if (cutout.removedShare > MAX_REMOVED_SHARE || !cutout.box) return "product_removed";
  const boxWidth = cutout.box.right - cutout.box.left + 1;
  const boxHeight = cutout.box.bottom - cutout.box.top + 1;
  if (
    (boxWidth * boxHeight) / (width * height) < MIN_PRODUCT_BOX_SHARE ||
    boxWidth / width < MIN_PRODUCT_SIDE_SHARE ||
    boxHeight / height < MIN_PRODUCT_SIDE_SHARE
  ) {
    return "product_too_small";
  }
  if (cutout.largePieces > MAX_LARGE_PIECES) return "fragmented";
  return null;
}

/**
 * Label the product's 4-connected pieces: fold specks into the backdrop, count
 * the large pieces, and measure the box of what is left. Mutates `backdrop`.
 */
function sweepPieces(
  backdrop: Uint8Array,
  width: number,
  height: number
): { largePieces: number; box: Cutout["box"]; removed: number } {
  const n = width * height;
  const speck = Math.max(1, Math.round(n * SPECK_SHARE));
  const large = Math.max(1, Math.round(n * LARGE_PIECE_SHARE));
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const piece: number[] = [];
  let largePieces = 0;

  let top = 0;
  for (let start = 0; start < n; start += 1) {
    if (backdrop[start] || seen[start]) continue;
    piece.length = 0;
    top = 0;
    stack[top++] = start;
    seen[start] = 1;
    const visit = (j: number) => {
      if (backdrop[j] || seen[j]) return;
      seen[j] = 1;
      stack[top++] = j;
    };
    while (top > 0) {
      const i = stack[--top];
      piece.push(i);
      const x = i % width;
      if (x > 0) visit(i - 1);
      if (x < width - 1) visit(i + 1);
      if (i >= width) visit(i - width);
      if (i < n - width) visit(i + width);
    }
    if (piece.length < speck) for (const i of piece) backdrop[i] = 1;
    else if (piece.length >= large) largePieces += 1;
  }

  let left = width;
  let right = -1;
  let topRow = height;
  let bottom = -1;
  let removed = 0;
  for (let i = 0; i < n; i += 1) {
    if (backdrop[i]) {
      removed += 1;
      continue;
    }
    const x = i % width;
    const y = (i - x) / width;
    if (x < left) left = x;
    if (x > right) right = x;
    if (y < topRow) topRow = y;
    if (y > bottom) bottom = y;
  }
  const box = right < 0 ? null : { left, top: topRow, right, bottom };
  return { largePieces, box, removed };
}

/** Step 4: the product's pixels with an alpha channel, feathered, trimmed, as PNG. */
async function encodeCutout(image: RgbaImage, cutout: Cutout, load: SharpLoader): Promise<CleanedImage | null> {
  const { width, height, data } = image;
  const { backdrop, backdropColour, box } = cutout;
  if (!box) return null;
  const out = new Uint8Array(data);
  const [br, bg, bb] = backdropColour;

  // Distance (in rings) from the backdrop for the product's two outer rings.
  const ring = new Uint8Array(width * height);
  for (let pass = 1; pass <= FEATHER_ALPHA.length; pass += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        if (backdrop[i] || ring[i]) continue;
        if (touches(x, y, width, height, (j) => (pass === 1 ? backdrop[j] === 1 : ring[j] === pass - 1))) ring[i] = pass;
      }
    }
  }

  const span = FILL_TOLERANCE * 2;
  for (let i = 0; i < width * height; i += 1) {
    const p = i * 4;
    if (backdrop[i]) {
      // Invisible, and the backdrop's colour keeps a resampled edge from darkening.
      out[p] = br;
      out[p + 1] = bg;
      out[p + 2] = bb;
      out[p + 3] = 0;
      continue;
    }
    const r = ring[i];
    if (!r) continue;
    const likeBackdrop = Math.min(1, colourDistance(data[p], data[p + 1], data[p + 2], br, bg, bb) / span);
    out[p + 3] = Math.min(data[p + 3], FEATHER_ALPHA[r - 1], Math.round(255 * likeBackdrop));
  }

  const margin = Math.max(4, Math.min(24, Math.round(0.02 * Math.max(box.right - box.left, box.bottom - box.top))));
  const left = Math.max(0, box.left - margin);
  const top = Math.max(0, box.top - margin);
  const cropWidth = Math.min(width, box.right + margin + 1) - left;
  const cropHeight = Math.min(height, box.bottom + margin + 1) - top;

  try {
    const sharp = await load();
    if (!sharp) return null;
    const png = await sharp(out, { raw: { width, height, channels: 4 } })
      .extract({ left, top, width: cropWidth, height: cropHeight })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const bytes = new Uint8Array(png.buffer, png.byteOffset, png.byteLength);
    const info = inspectImage(bytes);
    if (!info || info.format !== "image/png" || !info.hasAlpha) return null;
    return { bytes, info, crop: { left, top, width: cropWidth, height: cropHeight } };
  } catch {
    return null;
  }
}

/** Whether any 8-neighbour of (x, y) satisfies `test`. */
function touches(x: number, y: number, width: number, height: number, test: (j: number) => boolean): boolean {
  for (let dy = -1; dy <= 1; dy += 1) {
    const ny = y + dy;
    if (ny < 0 || ny >= height) continue;
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      if (nx < 0 || nx >= width) continue;
      if (test(ny * width + nx)) return true;
    }
  }
  return false;
}
