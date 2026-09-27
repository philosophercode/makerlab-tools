/**
 * When two image URLs name the same picture (gateway spec amendment
 * "Composites and product crop"): the page reader and the candidate list both
 * de-duplicate with {@link imageIdentity}, so a gallery's 640 px thumbnail and
 * its 2048 px zoom image, or an `og:image` and the same file with `&width=`,
 * are probed once.
 *
 * - **Scheme, fragment, a trailing slash and `www.`** never make a different
 *   image.
 * - **Size variants are one image.** A CDN's resize parameters
 *   ({@link SIZE_PARAMS}: `width`, `w`, `height`, `crop`, `dpr`, …, and
 *   Shopify's cache version `v`) are dropped from the query, and Shopify's
 *   size suffix in the file name (`_640x`, `_640x480`, `_x800`, `_grande`,
 *   `_master`, `@2x`, `_crop_center`) is removed before the extension.
 * - **Anything else in the query counts** — `?id=1` and `?id=2` are two images.
 *
 * Pure, no dependencies. Plain Node: step code imports this.
 */

/** Query parameters that pick a size, crop, format or cache version of the same image. */
export const SIZE_PARAMS = new Set([
  "width", "height", "w", "h", "crop", "quality", "fit", "format", "fm", "auto", "dpr", "size", "resize", "v",
  // Alibaba Cloud OSS's image processing (bambulab.com: `?x-oss-process=image/format,webp`).
  "x-oss-process",
]);

/** Shopify's size, crop and density suffix, just before the extension. */
const SHOPIFY_SUFFIX =
  /_(?:\d+x\d*|x\d+|pico|icon|thumb|small|compact|medium|large|grande|original|master)(?:_crop_[a-z]+)?(?:@\d+x)?(?=\.[a-z0-9]+$)/i;

/** A density suffix alone (`hero@2x.jpg`). */
const DENSITY_SUFFIX = /@\d+x(?=\.[a-z0-9]+$)/i;

/** The key two spellings of one picture share. Throws only for a string that is not a URL. */
export function imageIdentity(href: string): string {
  const url = new URL(href);
  const host = url.host.toLowerCase().replace(/^www\./, "");
  const path = url.pathname.replace(/\/+$/, "").replace(SHOPIFY_SUFFIX, "").replace(DENSITY_SUFFIX, "");
  const params = [...url.searchParams.entries()]
    .filter(([key]) => !SIZE_PARAMS.has(key.toLowerCase()))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = params.length > 0 ? `?${new URLSearchParams(params).toString()}` : "";
  return `${host}${path}${query}`;
}
