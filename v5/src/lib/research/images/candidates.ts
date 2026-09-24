import { IMAGE_EXA_TOPUP_BELOW, IMAGE_MAX_CANDIDATES } from "../../intake/limits.ts";
import { imageIdentity } from "../../web/image-url.ts";
import type { ImageHint } from "../../web/read-page.ts";
import { imagePageTier, type PageSubject } from "../source-pages.ts";

/**
 * Step 1 of the image stage (gateway spec §3.5; amendment "Composites and
 * product crop"): which images are worth probing at all.
 *
 * - **The pages come first.** An `og:image` or `twitter:image` is the image
 *   the manufacturer chose to show for the page research read, so those hints
 *   lead — every page's `og` before any page's `twitter`, each in the order the
 *   pages were read (a stable sort, so the first page's image leads its kind).
 * - **Then the pages' galleries, JSON-LD and `<img>` in turn.** A JSON-LD
 *   `Product.image` list and the large pictures in the page's content are
 *   interleaved (jsonld, gallery, jsonld, …), so a store whose JSON-LD lists
 *   five promotional banners cannot crowd its own clean gallery shots out of
 *   the list.
 * - **Exa only tops up.** Exa's `image` / `imageLinks` are search-engine guesses,
 *   so they are added only when the pages offered fewer than
 *   `IMAGE_EXA_TOPUP_BELOW` (3) images of their own.
 * - **One picture, one candidate.** URLs are compared by
 *   {@link imageIdentity}: without their fragment, `http` and `https` as one
 *   scheme, a trailing slash ignored — and a CDN's size variants
 *   (`&width=`, Shopify's `_640x`) as the same picture. The first spelling
 *   seen is kept.
 * - **http(s) only**, at most `IMAGE_MAX_CANDIDATES` (10), and nothing absurdly
 *   long: a `data:` URI or a 10 kB tracking URL is not a product photo.
 * - **The product page's pictures first** (amendment "Product-page first,
 *   front-facing images"). Given the item's brand and name, the page hints are
 *   taken in three groups — the brand's product page, then every other page,
 *   then manual, wiki, support and forum pages (`source-pages.ts`'s
 *   `imagePageTier`) — and the order above applies within each group. The
 *   X2D's candidates were all back and side views from its wiki; a product
 *   page's pictures now fill the list before a wiki's can.
 *
 * Pure: no network, no clock. Plain Node: step code imports this.
 */

/** Longer than this is not an image URL anyone should be asked to fetch or store. */
export const MAX_IMAGE_URL_LENGTH = 2048;

const META_ORDER: Partial<Record<ImageHint["source"], number>> = { og: 0, twitter: 1 };

export function collectCandidates(
  pageHints: readonly ImageHint[],
  exaHints: readonly ImageHint[],
  subject?: PageSubject
): ImageHint[] {
  const seen = new Set<string>();
  const out: ImageHint[] = [];

  const add = (hint: ImageHint) => {
    if (out.length >= IMAGE_MAX_CANDIDATES) return;
    const cleaned = cleanHint(hint);
    if (!cleaned) return;
    const key = dedupeKey(cleaned.url);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(cleaned);
  };

  const groups: ImageHint[][] = [[], [], []];
  for (const hint of pageHints) groups[subject ? imagePageTier(hint.pageUrl, subject) : 1].push(hint);

  for (const group of groups) {
    const meta = group
      .map((hint, index) => ({ hint, index }))
      .filter(({ hint }) => META_ORDER[hint.source] !== undefined)
      .sort((a, b) => META_ORDER[a.hint.source]! - META_ORDER[b.hint.source]! || a.index - b.index);
    for (const { hint } of meta) add(hint);

    const jsonld = group.filter((hint) => hint.source === "jsonld");
    const gallery = group.filter((hint) => hint.source === "gallery");
    for (let i = 0; i < Math.max(jsonld.length, gallery.length); i += 1) {
      if (i < jsonld.length) add(jsonld[i]);
      if (i < gallery.length) add(gallery[i]);
    }
  }

  if (out.length < IMAGE_EXA_TOPUP_BELOW) {
    for (const hint of exaHints) add({ ...hint, source: "exa" });
  }
  return out;
}

/** The hint with its URL made canonical (no fragment) and its page URL kept only when it is http(s). */
function cleanHint(hint: ImageHint): ImageHint | null {
  const url = httpUrl(hint.url);
  if (!url || url.href.length > MAX_IMAGE_URL_LENGTH) return null;
  url.hash = "";
  const page = hint.pageUrl ? httpUrl(hint.pageUrl) : null;
  return {
    url: url.href,
    source: hint.source,
    pageUrl: page && page.href.length <= MAX_IMAGE_URL_LENGTH ? page.href : null,
  };
}

function httpUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** What makes two spellings one picture — see {@link imageIdentity}. */
export function dedupeKey(href: string): string {
  return imageIdentity(href);
}
