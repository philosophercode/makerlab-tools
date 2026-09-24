/**
 * What kind of page a URL is, as far as research is concerned (amendment
 * "Product-page first, front-facing images, reviewer notes").
 *
 * The Bambu Lab X2D run read the manufacturer's **wiki** manual pages and a
 * YouTube video instead of the X2D product page on bambulab.com: the draft had
 * a two-sentence description, no confirmed specs, and a cover photo of the back
 * of the printer taken from the wiki. The manufacturer's own product page is
 * the one source that states the specs and shows the machine from the front, so
 * it leads:
 *
 * - {@link orderPagesForReading} — which of the search's links the read step
 *   reads (at most four): the best product page on the brand's own domain goes
 *   first whenever the search found one, and videos go last.
 * - {@link imagePageTier} — the image stage's source weighting: pictures from
 *   the product page before pictures from anywhere else, and pictures from
 *   manual, wiki and support pages last.
 * - {@link isVideoUrl} — a video is never where specs come from
 *   (`assemble.ts`).
 *
 * All heuristics on the URL alone — no network — and deliberately modest: a
 * page on the brand's domain whose path names a product (`/products/`,
 * `/en/x2d`, `/specs`) and is not a manual, wiki, support or forum page. A brand
 * the heuristic cannot match to a domain changes nothing: the model's own order
 * stands.
 *
 * Pure. Plain Node: step code imports this.
 */

/** Who the pages are about: the item's brand and name (either may be missing). */
export interface PageSubject {
  brand: string | null | undefined;
  name: string | null | undefined;
}

/** `product` — the brand's product/specs page; `brand` — another page of the brand's; `manual` — a manual, wiki, support or forum page anywhere; `video`; `other`. */
export type PageKind = "product" | "brand" | "manual" | "video" | "other";

const VIDEO_HOSTS = ["youtube.com", "youtu.be", "youtube-nocookie.com", "vimeo.com", "player.vimeo.com"];

/** Words in a brand name that say nothing about its domain. */
const GENERIC_BRAND_WORDS = new Set([
  "the", "and", "lab", "labs", "inc", "llc", "ltd", "gmbh", "co", "corp", "company", "corporation",
  "research", "tools", "tool", "technologies", "technology", "tech", "systems", "system", "machines",
  "machine", "industries", "international", "group", "products", "manufacturing", "design", "digital",
]);

/** A host's first label, or a path segment, that marks documentation rather than the product. */
const MANUAL_HOST_LABELS = new Set([
  "wiki", "support", "forum", "forums", "community", "help", "docs", "doc", "kb", "faq", "blog",
  "manual", "manuals", "download", "downloads", "learn", "academy",
]);
const MANUAL_PATH = /(?:^|[/_.-])(?:manuals?|wiki|support|forums?|community|help|docs?|documentation|downloads?|faq|blog|news|kb|knowledge-?base|guides?|troubleshoot\w*|tutorials?|user-?guide)(?=$|[/_.-])/;
const PRODUCT_PATH = /\/(?:products?|printers?|machines?|shop|store|buy)(?:\/|$)|(?:^|[/_-])(?:tech-?specs?|specs?|specifications?)(?=$|[/_.-])/;

export function isVideoUrl(raw: string): boolean {
  const host = hostOf(raw);
  return host !== null && VIDEO_HOSTS.some((video) => host === video || host.endsWith(`.${video}`));
}

/** What `raw` is, for `subject`. */
export function classifyPage(raw: string, subject: PageSubject): PageKind {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "other";
  }
  if (isVideoUrl(raw)) return "video";
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = decodeSafe(url.pathname).toLowerCase();
  const firstLabel = host.split(".")[0];
  const manual = MANUAL_HOST_LABELS.has(firstLabel) || MANUAL_PATH.test(path) || path.endsWith(".pdf");
  if (manual) return "manual";
  if (!isBrandHost(host, subject.brand)) return "other";
  return looksLikeProductPath(path, subject) ? "product" : "brand";
}

/**
 * The read step's page order: the model's order, except that the first
 * product page on the brand's domain (when there is one) is moved to the front
 * — so it is always among the pages read — and videos go after every other page.
 * De-duplicated; http(s) only; at most `max`.
 */
export function orderPagesForReading(urls: readonly string[], subject: PageSubject, max: number): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    const url = httpUrl(raw);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    unique.push(url);
  }
  const product = unique.find((url) => classifyPage(url, subject) === "product");
  const rest = unique.filter((url) => url !== product);
  const ordered = [
    ...(product ? [product] : []),
    ...rest.filter((url) => !isVideoUrl(url)),
    ...rest.filter((url) => isVideoUrl(url)),
  ];
  return ordered.slice(0, Math.max(0, max));
}

/**
 * The image stage's weight for the page a picture was declared on: 0 for the
 * brand's product page, 1 for any other page (or none), 2 for a manual, wiki,
 * support or forum page — where pictures are diagrams, parts and back views.
 */
export function imagePageTier(pageUrl: string | null | undefined, subject: PageSubject): 0 | 1 | 2 {
  if (!pageUrl) return 1;
  const kind = classifyPage(pageUrl, subject);
  if (kind === "product") return 0;
  if (kind === "manual") return 2;
  return 1;
}

/** True when `host` looks like the brand's own domain: a label of it contains the brand's name, or a distinctive word of it. */
export function isBrandHost(host: string, brand: string | null | undefined): boolean {
  const tokens = brandTokens(brand);
  if (tokens.length === 0) return false;
  const labels = host.toLowerCase().replace(/^www\./, "").split(".");
  // The registrable part and anything below it, but not the public suffix.
  const named = labels.length > 1 ? labels.slice(0, -1) : labels;
  return named.some((label) => tokens.some((token) => label.includes(token)));
}

/** The brand, squashed ("bambulab"), and each distinctive word of it ("bambu"), shortest useful length 3. */
function brandTokens(brand: string | null | undefined): string[] {
  const words = (brand ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/[\s-]+/)
    .filter(Boolean);
  if (words.length === 0) return [];
  const tokens = new Set<string>();
  const squashed = words.join("");
  if (squashed.length >= 3) tokens.add(squashed);
  for (const word of words) if (word.length >= 3 && !GENERIC_BRAND_WORDS.has(word)) tokens.add(word);
  return [...tokens];
}

/** A product path: a product/specs segment, or a segment naming the model (a word of the name that is not the brand's and has a digit, e.g. "x2d"). */
function looksLikeProductPath(path: string, subject: PageSubject): boolean {
  if (PRODUCT_PATH.test(path)) return true;
  const models = modelTokens(subject);
  if (models.length === 0) return false;
  const segments = path.split("/").filter(Boolean);
  return segments.some((segment) => models.some((model) => segment === model || segment.split(/[-_.]/).includes(model)));
}

function modelTokens(subject: PageSubject): string[] {
  const brand = new Set(brandTokens(subject.brand));
  return (subject.name ?? "")
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((word) => word.length >= 2 && /\d/.test(word) && /[a-z]/.test(word) && !brand.has(word));
}

function httpUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function hostOf(raw: string): string | null {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function decodeSafe(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
