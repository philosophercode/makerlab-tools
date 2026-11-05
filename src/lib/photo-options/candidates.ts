import { IMAGE_MAX_CANDIDATES } from "../intake/limits.ts";
import { MAX_IMAGE_URL_LENGTH } from "../research/images/candidates.ts";
import type { RankedImage } from "../research/images/rank.ts";
import { imagePageTier, type PageSubject } from "../research/source-pages.ts";
import { imageIdentity } from "../web/image-url.ts";
import type { ImageHint } from "../web/read-page.ts";
import type { PhotoOption } from "./types.ts";

/**
 * The pure half of a photo options search (photo options spec 2026-10-29 §3):
 * which pictures go to the ranking, what the ranking is told to prefer, and
 * what is stored. No network, no clock. Plain Node.
 */

/** The longest note a person may give a photo search. */
export const PHOTO_NOTE_MAX_CHARS = 500;

/**
 * What every photo options search asks for, before the person's own note: the
 * maker's own marketing picture, not a shop's. This is the complaint the
 * feature exists for — the wrong machine, a busy backdrop, a photo taken in a
 * store — so it rides on both the search and the ranking.
 */
export const PHOTO_PREFERENCE =
  "Prefer the manufacturer's own official product or marketing photo of the whole machine, front or three-quarter view, on a plain white or transparent background. Avoid retailer and marketplace listings, photos taken in a shop, showroom or workshop, and pictures of a different model.";

/** The instruction the search and the ranking get: the house preference, then the person's note. */
export function photoSearchInstruction(note: string | null): string {
  return note ? `${PHOTO_PREFERENCE} The staff member adds: ${note}` : PHOTO_PREFERENCE;
}

/**
 * The tool's brand, when its name and its own links agree on one. A tool has no
 * brand column (refresh research spec §3.1), so the name's first two words
 * ("Bambu Lab", matching `bambulab.com` run together) or first word ("Prusa",
 * matching `prusa3d.com`) is taken as the brand **only** when one of the tool's
 * own resource links is on a host that carries it. Otherwise null, and no
 * picture is marked the manufacturer's: guessing from the name alone would call
 * `sewingmachinesplus.com` the maker of a "Sewing machine".
 */
export function brandFromLinks(name: string, resourceUrls: readonly string[]): string | null {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  const labels = resourceUrls.flatMap((url) => {
    try {
      const parts = new URL(url).hostname.toLowerCase().replace(/^www\./, "").split(".");
      return parts.length > 1 ? parts.slice(0, -1) : parts;
    } catch {
      return [];
    }
  });
  const squash = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
  const two = squash(words.slice(0, 2).join(""));
  if (two.length >= 4 && labels.some((label) => label.includes(two))) return words.slice(0, 2).join(" ");
  const one = squash(words[0]);
  if (one.length >= 3 && labels.some((label) => label.includes(one))) return words[0];
  return null;
}

/**
 * The pictures worth ranking: the pages' and the search's together, nothing
 * an earlier search offered and nothing the tool already has as a photo — so
 * asking again finds others. Ordered by the page each was declared on
 * (`imagePageTier`: the brand's product page first, manuals and forums last),
 * and within a tier the tool's own links and the search taken in turn. http(s)
 * only, one picture once (`imageIdentity`), at most `IMAGE_MAX_CANDIDATES`.
 */
export function photoCandidates(
  pageHints: readonly ImageHint[],
  searchHints: readonly ImageHint[],
  opts: { exclude: readonly string[]; subject: PageSubject }
): ImageHint[] {
  const seen = new Set(opts.exclude.map((url) => imageIdentity(url)));
  const tiers: ImageHint[][][] = [0, 1, 2].map(() => [[], []]);
  [pageHints, searchHints].forEach((hints, from) => {
    for (const hint of hints) tiers[imagePageTier(hint.pageUrl, opts.subject)][from].push(hint);
  });

  const out: ImageHint[] = [];
  for (const [pages, search] of tiers) {
    for (let i = 0; i < Math.max(pages.length, search.length); i += 1) {
      for (const hint of [pages[i], search[i]]) {
        if (!hint || out.length >= IMAGE_MAX_CANDIDATES) continue;
        const cleaned = httpHint(hint);
        if (!cleaned) continue;
        const key = imageIdentity(cleaned.url);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(cleaned);
      }
    }
  }
  return out;
}

function httpHint(hint: ImageHint): ImageHint | null {
  const http = (raw: string | null | undefined) => {
    if (!raw) return null;
    try {
      const url = new URL(raw.trim());
      if ((url.protocol !== "http:" && url.protocol !== "https:") || url.href.length > MAX_IMAGE_URL_LENGTH) return null;
      url.hash = "";
      return url.href;
    } catch {
      return null;
    }
  };
  const url = http(hint.url);
  return url ? { url, source: hint.source, pageUrl: http(hint.pageUrl) } : null;
}

/** A ranked picture as stored and shown. */
export function toPhotoOption(ranked: RankedImage): PhotoOption {
  const { candidate } = ranked;
  return {
    url: candidate.url,
    pageUrl: candidate.pageUrl,
    source: candidate.source,
    width: candidate.width,
    height: candidate.height,
    contentType: candidate.contentType,
    reason: candidate.reason,
    ...(candidate.background ? { background: candidate.background } : {}),
    ...(candidate.composite ? { composite: true } : {}),
    ...(candidate.view ? { view: candidate.view } : {}),
    ...(candidate.productBox ? { productBox: candidate.productBox } : {}),
    ...(ranked.manufacturer ? { manufacturer: true } : {}),
  };
}
