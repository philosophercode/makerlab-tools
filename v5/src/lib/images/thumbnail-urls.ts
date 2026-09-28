/**
 * Pre-generated thumbnails of one image, and the URLs a page asks for.
 *
 * Every tool photo is shown small — a gallery card is ~180–240 CSS px wide and
 * the tool page's hero at most 256 — but the originals are 1–2.5 MB PNGs and
 * phone photos. So each image is resized once, ahead of time, to a few widths
 * in AVIF and WebP (`./thumbnails.ts`), and the page offers them as a
 * `<picture>` with a `srcset` the browser picks from (`ToolImage`).
 *
 * The files sit next to each other and differ only in width and format:
 * `${base}.${width}.${format}`. So a row stores one base URL and its widths,
 * not eight URLs, and the gallery's payload stays small.
 *
 * The base carries a content hash of the source image (bundled photos) or
 * lives under a random Blob pathname (uploads), so a thumbnail URL never
 * changes meaning and is served `immutable`.
 *
 * Client-safe and dependency-free: `ToolImage` imports it, and so do the
 * scripts under plain Node.
 */

/** The widths every thumbnail set is rendered at, when the source is at least that wide. */
export const THUMBNAIL_WIDTHS = [160, 320, 640] as const;

/** Both formats are written for every width; the browser takes the first it supports. */
export const THUMBNAIL_FORMATS = ["avif", "webp"] as const;
export type ThumbnailFormat = (typeof THUMBNAIL_FORMATS)[number];

export const THUMBNAIL_CONTENT_TYPES: Record<ThumbnailFormat, string> = {
  avif: "image/avif",
  webp: "image/webp",
};

export interface ImageThumbnails {
  /** Every URL is `${base}.${width}.${format}`. */
  base: string;
  /** Ascending. At least one. */
  widths: number[];
  /** The source image's size, for the `<img>`'s `width`/`height` (its aspect ratio). */
  width: number;
  height: number;
}

export function thumbnailUrl(thumbnails: ImageThumbnails, width: number, format: ThumbnailFormat): string {
  return `${thumbnails.base}.${width}.${format}`;
}

/** `srcset` for one format: every width, with its `w` descriptor. */
export function thumbnailSrcSet(thumbnails: ImageThumbnails, format: ThumbnailFormat): string {
  return thumbnails.widths.map((width) => `${thumbnailUrl(thumbnails, width, format)} ${width}w`).join(", ");
}

/**
 * The `<img src>` for a browser that ignores `srcset`: the WebP nearest 320 px
 * (a card on a 2× phone), never the largest.
 */
export function thumbnailFallbackSrc(thumbnails: ImageThumbnails): string {
  const width = thumbnails.widths.find((w) => w >= 320) ?? thumbnails.widths[thumbnails.widths.length - 1];
  return thumbnailUrl(thumbnails, width, "webp");
}

/**
 * The widths to render a source image of `sourceWidth` pixels at: every
 * standard width it is at least as wide as, plus its own width when it is
 * narrower than the largest (so a small image still gets its full-size
 * rendition). Never an enlargement.
 */
export function plannedWidths(sourceWidth: number): number[] {
  const source = Math.max(1, Math.floor(sourceWidth));
  const widths: number[] = THUMBNAIL_WIDTHS.filter((w) => w <= source);
  const largest = THUMBNAIL_WIDTHS[THUMBNAIL_WIDTHS.length - 1];
  if (source < largest && !widths.includes(source)) widths.push(source);
  return widths;
}

/**
 * The Blob pathnames of a stored set (`thumbs/…`), from its base URL — what
 * the daily sweep deletes beside an orphaned original. Works for Vercel Blob
 * URLs and the local store's `/api/dev-blob/…` ones; empty for anything else
 * (a bundled set, a malformed value).
 */
export function thumbnailBlobPathnames(thumbnails: unknown): string[] {
  if (!isImageThumbnails(thumbnails)) return [];
  let path: string;
  try {
    path = decodeURIComponent(new URL(thumbnails.base).pathname);
  } catch {
    return [];
  }
  const stem = path.startsWith("/api/dev-blob/") ? path.slice("/api/dev-blob/".length) : path.slice(1);
  if (!stem.startsWith("thumbs/")) return [];
  return thumbnails.widths.flatMap((w) => THUMBNAIL_FORMATS.map((f) => thumbnailUrl({ ...thumbnails, base: stem }, w, f)));
}

/** True for a value read back from a jsonb column that has the shape. */
export function isImageThumbnails(value: unknown): value is ImageThumbnails {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.base === "string" &&
    v.base.length > 0 &&
    Array.isArray(v.widths) &&
    v.widths.length > 0 &&
    v.widths.every((w) => Number.isInteger(w) && (w as number) > 0) &&
    Number.isInteger(v.width) &&
    Number.isInteger(v.height) &&
    (v.width as number) > 0 &&
    (v.height as number) > 0
  );
}
