import { imageIdentity } from "./image-url.ts";
import type { ImageHint } from "./read-page.ts";

/**
 * HTML to readable text, plus the product images a page declares (gateway spec
 * §3.3 "HTML to text", §3.5).
 *
 * **No HTML library, on purpose** (spec open question 5). Nothing in the
 * dependency tree fits: `parse5` is only a transitive devDependency (through
 * jsdom), so production code cannot rely on it. What is needed is small — drop
 * the elements that are never content, prefer `<main>` / `<article>`, keep the
 * rest as text, read a handful of `<meta>` tags and the JSON-LD blocks — so this
 * is a focused tokenizer: tags, comments, raw-text elements and text, with a
 * skip stack. It does not build a tree and does not try to repair markup; a
 * page it misreads yields worse text, never an exception.
 *
 * Plain Node: step code imports this.
 */

export interface ExtractedPage {
  title: string | null;
  text: string;
  /**
   * og:image, then twitter:image, then JSON-LD `Product.image`, then the large
   * pictures in the page's content (its gallery) — resolved, and de-duplicated
   * by {@link imageIdentity}, so a size variant of an image already listed is
   * not listed again.
   */
  images: ImageHint[];
}

/** At most this many gallery pictures are taken from one page. */
export const GALLERY_MAX_PER_PAGE = 12;

/** An `<img>` whose `width` or `height` attribute is below this is an icon, a swatch or a thumbnail. */
export const GALLERY_MIN_ATTR_PX = 300;

/** A `srcset` whose largest width descriptor is below this has no picture big enough to be a cover. */
export const GALLERY_MIN_SRCSET_W = 400;

/** File names that are page furniture, never a product photo. */
const FURNITURE = /(?:^|[\W_])(?:logo|icon|icons|sprite|avatar|badge|payment|flag|placeholder|spinner|loader|loading|rating|stars?|arrow|social|favicon)(?:[\W_]|$)/i;

interface GalleryImage {
  raw: string;
  /** Inside `<main>` or `<article>`: the page's own content rather than its chrome. */
  inContent: boolean;
}

/** Elements whose whole subtree is never page content. */
const DROPPED = new Set([
  "script", "style", "noscript", "nav", "header", "footer", "aside", "svg", "form",
  "template", "iframe", "object", "canvas", "select", "button", "dialog", "math",
]);

/** Elements whose content is raw text up to their own end tag. */
const RAW_TEXT = new Set(["script", "style", "textarea", "title", "xmp", "noscript", "iframe", "template"]);

/** Elements that never have an end tag. */
const VOID = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
]);

/** Elements that start a new line of text. */
const BLOCK = new Set([
  "address", "article", "blockquote", "br", "dd", "details", "div", "dl", "dt", "fieldset", "figcaption",
  "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "li", "main", "ol", "p", "pre", "section", "summary",
  "table", "tbody", "thead", "tfoot", "tr", "ul", "caption",
]);

/** Cells separate with a space; rows are block-level above. */
const CELL = new Set(["td", "th"]);

type Region = "main" | "article" | "body";

export function extractPage(html: string, baseUrl: string): ExtractedPage {
  let base = baseUrl;
  let title: string | null = null;
  const og: string[] = [];
  const twitter: string[] = [];
  const jsonLd: string[] = [];
  const gallery: GalleryImage[] = [];

  const out: Record<Region, string[]> = { main: [], article: [], body: [] };
  const open: Record<Region, number> = { main: 0, article: 0, body: 0 };
  const skip: string[] = [];

  const emit = (text: string) => {
    if (skip.length > 0) return;
    out.body.push(text);
    if (open.main > 0) out.main.push(text);
    if (open.article > 0) out.article.push(text);
  };

  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      emit(html.slice(i));
      break;
    }
    if (lt > i) emit(html.slice(i, lt));

    // Comments, doctype, CDATA, processing instructions.
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (html[lt + 1] === "!" || html[lt + 1] === "?") {
      const end = html.indexOf(">", lt + 2);
      i = end === -1 ? n : end + 1;
      continue;
    }

    const tag = readTag(html, lt);
    if (!tag) {
      // A bare "<" in text.
      emit("<");
      i = lt + 1;
      continue;
    }
    i = tag.end;

    if (tag.closing) {
      if (skip.length > 0) {
        const at = skip.lastIndexOf(tag.name);
        if (at !== -1) skip.length = at;
        continue;
      }
      if (tag.name === "main" || tag.name === "article") open[tag.name] = Math.max(0, open[tag.name] - 1);
      if (BLOCK.has(tag.name)) emit("\n");
      else if (CELL.has(tag.name)) emit(" ");
      continue;
    }

    // Start tag.
    if (tag.name === "meta") {
      readMeta(tag.attrs, og, twitter);
      continue;
    }
    if (tag.name === "base" && tag.attrs.href) {
      try {
        base = new URL(decodeEntities(tag.attrs.href), baseUrl).href;
      } catch {
        // Keep the page's own URL.
      }
      continue;
    }

    if (RAW_TEXT.has(tag.name) && !tag.selfClosing) {
      const close = findClose(html, tag.name, i);
      const content = html.slice(i, close.start);
      i = close.end;
      if (tag.name === "title" && title === null) {
        const value = collapse(decodeEntities(content));
        title = value.length > 0 ? value : null;
      }
      if (tag.name === "script" && /application\/ld\+json/i.test(tag.attrs.type ?? "")) jsonLd.push(content);
      if (tag.name === "textarea" && skip.length === 0) emit(content);
      continue;
    }

    if (DROPPED.has(tag.name)) {
      if (!tag.selfClosing && !VOID.has(tag.name)) skip.push(tag.name);
      continue;
    }
    if (skip.length > 0) {
      // Track nesting of the dropped element's own name, so `<nav><nav></nav></nav>` closes right.
      if (!tag.selfClosing && !VOID.has(tag.name) && tag.name === skip[skip.length - 1]) skip.push(tag.name);
      continue;
    }

    if (tag.name === "img" || tag.name === "source") {
      const raw = galleryImage(tag.name, tag.attrs);
      if (raw) gallery.push({ raw, inContent: open.main > 0 || open.article > 0 });
      continue;
    }

    if (tag.name === "main" || tag.name === "article") open[tag.name] += 1;
    if (BLOCK.has(tag.name)) emit("\n");
    else if (CELL.has(tag.name)) emit(" ");
  }

  const pick = (region: Region) => cleanText(out[region].join(""));
  const text = pick("main") || pick("article") || pick("body");

  // A page with a <main> or <article> keeps its gallery there; the rest is chrome.
  const content = gallery.some((image) => image.inContent) ? gallery.filter((image) => image.inContent) : gallery;
  const images = collectImages(base, baseUrl, og, twitter, jsonLdImages(jsonLd), content.map((image) => image.raw));
  return { title, text, images };
}

interface Tag {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  attrs: Record<string, string>;
  end: number;
}

/** An unquoted attribute value; sticky, so it reads in place instead of slicing the page. */
const BARE_VALUE = /[^\s>]*/y;

/** The tag starting at `lt`, or null when the "<" does not open one. */
function readTag(html: string, lt: number): Tag | null {
  let i = lt + 1;
  const closing = html[i] === "/";
  if (closing) i += 1;
  const nameMatch = /^[a-zA-Z][a-zA-Z0-9:-]*/.exec(html.slice(i, i + 64));
  if (!nameMatch) return null;
  const name = nameMatch[0].toLowerCase();
  i += nameMatch[0].length;

  const attrs = Object.create(null) as Record<string, string>;
  let selfClosing = false;
  const n = html.length;
  while (i < n) {
    const ch = html[i];
    if (ch === ">") return { name, closing, selfClosing, attrs, end: i + 1 };
    if (ch === "/") {
      selfClosing = html[i + 1] === ">";
      i += 1;
      continue;
    }
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    // An attribute name, then an optional value.
    const attrName = /^[^\s/>=]+/.exec(html.slice(i, i + 256));
    if (!attrName) {
      i += 1;
      continue;
    }
    i += attrName[0].length;
    while (i < n && /\s/.test(html[i])) i += 1;
    let value = "";
    if (html[i] === "=") {
      i += 1;
      while (i < n && /\s/.test(html[i])) i += 1;
      const quote = html[i];
      if (quote === '"' || quote === "'") {
        const end = html.indexOf(quote, i + 1);
        value = html.slice(i + 1, end === -1 ? n : end);
        i = end === -1 ? n : end + 1;
      } else {
        BARE_VALUE.lastIndex = i;
        const bare = BARE_VALUE.exec(html)?.[0] ?? "";
        value = bare;
        i += bare.length;
      }
    }
    const key = attrName[0].toLowerCase();
    if (!(key in attrs)) attrs[key] = value;
  }
  return { name, closing, selfClosing, attrs, end: n };
}

/** Where the end tag of a raw-text element starts and ends, from `from`. */
function findClose(html: string, name: string, from: number): { start: number; end: number } {
  const re = new RegExp(`</${name}\\s*>`, "ig");
  re.lastIndex = from;
  const match = re.exec(html);
  if (!match) return { start: html.length, end: html.length };
  return { start: match.index, end: match.index + match[0].length };
}

function readMeta(attrs: Record<string, string>, og: string[], twitter: string[]) {
  const key = (attrs.property ?? attrs.name ?? "").trim().toLowerCase();
  const content = attrs.content;
  if (!content) return;
  if (key === "og:image" || key === "og:image:url" || key === "og:image:secure_url") og.push(content);
  else if (key === "twitter:image" || key === "twitter:image:src") twitter.push(content);
}

/** Every `Product.image` in the JSON-LD blocks, in document order. */
function jsonLdImages(blocks: string[]): string[] {
  const found: string[] = [];
  for (const block of blocks) {
    const cleaned = block.trim().replace(/^<!\[CDATA\[|\]\]>$/g, "").replace(/^<!--|-->$/g, "").trim();
    let data: unknown;
    try {
      data = JSON.parse(cleaned);
    } catch {
      continue;
    }
    walk(data, 0, found, { nodes: 0 });
  }
  return found;
}

function walk(node: unknown, depth: number, found: string[], budget: { nodes: number }) {
  if (depth > 12 || budget.nodes > 5000 || node === null || typeof node !== "object") return;
  budget.nodes += 1;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, depth + 1, found, budget);
    return;
  }
  const record = node as Record<string, unknown>;
  if (isProduct(record["@type"])) imageValues(record.image, found, 0);
  for (const [key, value] of Object.entries(record)) {
    if (key === "image") continue;
    walk(value, depth + 1, found, budget);
  }
}

/** `Product`, and the kinds of product Shopify and others declare instead (`ProductGroup`, …). */
function isProduct(type: unknown): boolean {
  const types = Array.isArray(type) ? type : [type];
  return types.some(
    (t) =>
      typeof t === "string" &&
      /^(?:(?:https?:\/\/)?schema\.org\/|schema:)?(?:product|productgroup|productmodel|individualproduct)$/i.test(t.trim())
  );
}

/** A `Product.image`: a URL, an ImageObject (`url` / `contentUrl`), or an array of either. */
function imageValues(value: unknown, found: string[], depth: number) {
  if (depth > 3 || value === null || value === undefined) return;
  if (typeof value === "string") {
    found.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) imageValues(item, found, depth + 1);
    return;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const url = obj.url ?? obj.contentUrl ?? obj["@id"];
    imageValues(url, found, depth + 1);
  }
}

function collectImages(
  base: string,
  pageUrl: string,
  og: string[],
  twitter: string[],
  jsonld: string[],
  gallery: string[]
): ImageHint[] {
  const images: ImageHint[] = [];
  const seen = new Set<string>();
  // An https page's http image is upgraded, as a browser upgrades mixed content:
  // the review page shows it from an https origin, and the http spelling is often
  // only a redirect to the same file.
  const secure = pageUrl.startsWith("https:");
  const add = (raw: string, source: ImageHint["source"]): boolean => {
    let url = resolveHttp(decodeEntities(raw.trim()), base);
    if (!url) return false;
    if (secure && url.startsWith("http:")) url = `https:${url.slice("http:".length)}`;
    const key = imageIdentity(url);
    if (seen.has(key)) return false;
    seen.add(key);
    images.push({ url, source, pageUrl });
    return true;
  };
  for (const raw of og) add(raw, "og");
  for (const raw of twitter) add(raw, "twitter");
  for (const raw of jsonld) add(raw, "jsonld");
  let fromGallery = 0;
  for (const raw of gallery) {
    if (fromGallery >= GALLERY_MAX_PER_PAGE) break;
    if (add(raw, "gallery")) fromGallery += 1;
  }
  return images;
}

/**
 * The picture an `<img>` or `<picture><source>` offers at its largest, or null
 * when it is not worth probing: too small by its own attributes, page
 * furniture by its file name, an SVG or GIF, inline data, or not a URL at all
 * (a template's error text in `src`). Lazy-loading attributes count
 * (`data-srcset`, `data-src`, `data-zoom-image`, `data-large_image`).
 */
function galleryImage(tagName: "img" | "source" | string, attrs: Record<string, string>): string | null {
  if (tagName === "source") {
    // A <video>'s or <audio>'s source is not a picture.
    const type = (attrs.type ?? "").trim().toLowerCase();
    if (type && !type.startsWith("image/")) return null;
  }
  for (const key of ["width", "height"]) {
    const value = attrs[key];
    if (value !== undefined && /^\s*\d+/.test(value) && parseInt(value, 10) < GALLERY_MIN_ATTR_PX) return null;
  }

  const srcset = attrs.srcset ?? attrs["data-srcset"];
  let raw: string | null = null;
  if (srcset) {
    const best = largestInSrcset(decodeEntities(srcset));
    if (best === "too_small") return null;
    raw = best;
  }
  if (!raw && tagName === "img") {
    raw = attrs["data-zoom-image"] ?? attrs["data-large_image"] ?? attrs["data-src"] ?? attrs.src ?? null;
  }
  if (!raw) return null;

  const value = decodeEntities(raw).trim();
  if (!value || /\s/.test(value) || /^data:/i.test(value)) return null;
  const path = value.split(/[?#]/)[0];
  if (/\.(?:svg|gif)$/i.test(path)) return null;
  const file = path.slice(path.lastIndexOf("/") + 1);
  if (FURNITURE.test(file)) return null;
  return value;
}

/**
 * The largest candidate of a `srcset`: the biggest `w` descriptor, else the
 * biggest `x`, else the first. `"too_small"` when every `w` is under
 * {@link GALLERY_MIN_SRCSET_W}. Entries are split on a comma followed by
 * whitespace, so a URL with commas of its own (`w_300,h_200`) survives.
 */
function largestInSrcset(srcset: string): string | "too_small" | null {
  let bestW: { url: string; size: number } | null = null;
  let bestX: { url: string; size: number } | null = null;
  let first: string | null = null;
  for (const entry of srcset.split(/,\s+/)) {
    const [url, descriptor = ""] = entry.trim().split(/\s+/, 2);
    if (!url) continue;
    first ??= url;
    const w = /^(\d+)w$/i.exec(descriptor);
    const x = /^(\d+(?:\.\d+)?)x$/i.exec(descriptor);
    if (w) {
      const size = parseInt(w[1], 10);
      if (!bestW || size > bestW.size) bestW = { url, size };
    } else if (x) {
      const size = parseFloat(x[1]);
      if (!bestX || size > bestX.size) bestX = { url, size };
    }
  }
  if (bestW) return bestW.size < GALLERY_MIN_SRCSET_W ? "too_small" : bestW.url;
  return bestX?.url ?? first;
}

function resolveHttp(value: string, base: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Text to lines: entities decoded, runs of spaces collapsed, blank lines dropped. */
function cleanText(raw: string): string {
  return decodeEntities(raw)
    .split("\n")
    .map(collapse)
    .filter((line) => line.length > 0)
    .join("\n");
}

function collapse(text: string): string {
  return text.replace(/[\s ​]+/g, " ").trim();
}

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", shy: "", copy: "©", reg: "®",
  trade: "™", hellip: "…", mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", sbquo: "‚", ldquo: "“",
  rdquo: "”", bdquo: "„", laquo: "«", raquo: "»", lsaquo: "‹", rsaquo: "›", bull: "•", middot: "·",
  deg: "°", plusmn: "±", times: "×", divide: "÷", micro: "µ", frac12: "½", frac14: "¼", frac34: "¾",
  sup1: "¹", sup2: "²", sup3: "³", euro: "€", pound: "£", yen: "¥", cent: "¢", sect: "§", para: "¶",
  prime: "′", Prime: "″", larr: "←", rarr: "→", uarr: "↑", darr: "↓", le: "≤", ge: "≥", ne: "≠",
  asymp: "≈", infin: "∞", ohm: "Ω", Omega: "Ω", mu: "μ", alpha: "α", beta: "β",
  zwj: "‍", zwnj: "‌", ensp: " ", emsp: " ", thinsp: " ", iexcl: "¡", iquest: "¿",
  eacute: "é", Eacute: "É", egrave: "è", ecirc: "ê", euml: "ë", aacute: "á", agrave: "à", acirc: "â",
  auml: "ä", Auml: "Ä", aring: "å", ccedil: "ç", iacute: "í", ntilde: "ñ", oacute: "ó", ouml: "ö",
  Ouml: "Ö", oslash: "ø", uacute: "ú", uuml: "ü", Uuml: "Ü", szlig: "ß",
};

/** Named (a common set) and numeric character references; unknown names are left as written. */
export function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,31});?/gi, (match, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "�";
      return String.fromCodePoint(code);
    }
    const named = NAMED[ref] ?? NAMED[ref.toLowerCase()];
    return named ?? match;
  });
}
