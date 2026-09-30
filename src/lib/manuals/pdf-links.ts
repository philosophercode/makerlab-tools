import { titleLanguage, urlLanguage } from "../research/language.ts";

/**
 * Where a manual's PDF is on a page that is not the PDF (manual text spec
 * amendment 2026-09-28 "Follow the download page to the PDF"). Research kept
 * stopping one step short: the URL it saved was a manufacturer's page with the
 * manual in a viewer, or behind a Download button. This reads such a page's
 * HTML and lists, best first, the addresses that may be the file:
 *
 * | Found as | Score |
 * |---|---|
 * | a PDF.js viewer's `?file=` (in an iframe, a link, or the page's own URL) | 95 |
 * | an `<iframe>`/`<embed>`/`<object>`/`<source>` whose address is a PDF | 90 |
 * | a Google Drive file (`/file/d/<id>/view`, `open?id=`) → its direct download | 85 |
 * | a Dropbox share (`?dl=0`) → `?dl=1` | 85 |
 * | a link or `data-*` attribute to a `.pdf` | 80 (+10 when its words say manual/guide) |
 * | a link with a `download` attribute | 75 |
 * | a `<meta http-equiv="refresh">` target | 70 |
 * | a link whose words say Download / Manual / User Guide / PDF | 50 — a page to follow, or a download endpoint |
 *
 * **English only**: a candidate whose address says another locale
 * (`/de-de/`, `_DE.pdf`) or whose link words are not English is dropped.
 * **Host rule** ({@link isAllowedHost}): the landing page's own site or a
 * known file host (Drive, Dropbox, the big CDNs); anything else is dropped,
 * so a page cannot send the resolver across the web.
 *
 * Pure: HTML in, candidates out. The fetching, the hop limit and the PDF check
 * are `resolve-pdf.ts`'s. Plain Node: step code imports it.
 */

export interface PdfCandidate {
  url: string;
  reason: string;
  score: number;
  /** Probably the file itself (a PDF address, a viewer's file, a Drive/Dropbox download), not a page to follow. */
  direct: boolean;
}

const MANUAL_WORDS = /\b(manual|user\s*guide|guide|handbook|instructions?|owner'?s|operating|quick\s*start|datasheet|data\s*sheet)\b/i;
const DOWNLOAD_WORDS = /\b(download|pdf|manual|user\s*guide|instructions?|handbook)\b/i;

/** Known file hosts a manufacturer's page may point at, besides its own site. */
const FILE_HOSTS = [
  "drive.google.com",
  "docs.google.com",
  "drive.usercontent.google.com",
  "googleusercontent.com",
  "dropbox.com",
  "dropboxusercontent.com",
  "cloudfront.net",
  "amazonaws.com",
  "azureedge.net",
  "blob.core.windows.net",
  "akamaized.net",
  "akamaihd.net",
  "cdn.shopify.com",
  "shopify.com",
  "bblcdn.com",
  "bblcdn.cn",
  "salsify.com",
  "widen.net",
  "bynder.com",
  "scene7.com",
  "cloudinary.com",
  "ctfassets.net",
  "hubspotusercontent-na1.net",
  "hubspotusercontent10.net",
  "hubspotusercontent20.net",
  "hubspotusercontent30.net",
  "hubspotusercontent40.net",
  "wixstatic.com",
  "squarespace-cdn.com",
  "zendesk.com",
];

/** Second-level labels that are part of a country's public suffix (`co.uk`, `com.au`). */
const PUBLIC_SECOND_LEVEL = new Set(["co", "com", "net", "org", "ac", "gov", "edu", "ne", "or"]);

/** `support.prusa3d.com` → `prusa3d.com`; `www.bosch.co.uk` → `bosch.co.uk`. */
export function siteOf(hostname: string): string {
  const labels = hostname.toLowerCase().replace(/\.$/, "").split(".");
  if (labels.length <= 2) return labels.join(".");
  const second = labels[labels.length - 2];
  const take = labels[labels.length - 1].length === 2 && PUBLIC_SECOND_LEVEL.has(second) ? 3 : 2;
  return labels.slice(-take).join(".");
}

/** The landing page's own site, or a known file host (a subdomain of one included). */
export function isAllowedHost(candidate: string, landing: string): boolean {
  let c: URL;
  let l: URL;
  try {
    c = new URL(candidate);
    l = new URL(landing);
  } catch {
    return false;
  }
  if (c.protocol !== "http:" && c.protocol !== "https:") return false;
  const host = c.hostname.toLowerCase();
  if (siteOf(host) === siteOf(l.hostname)) return true;
  return FILE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

export function isPdfPath(raw: string): boolean {
  try {
    return new URL(raw).pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}

/**
 * The address that downloads the file a share or viewer link shows — a PDF.js
 * viewer's `?file=`, a Drive file's `uc?export=download&id=`, a Dropbox
 * share's `?dl=1` — or null when `raw` is none of those.
 */
export function directDownloadUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const file = url.searchParams.get("file");
  if (file && /(viewer|pdfjs|pdf\.js|web\/viewer)/i.test(url.pathname)) {
    try {
      return new URL(file, url).href;
    } catch {
      return null;
    }
  }
  if (host === "drive.google.com" || host === "docs.google.com") {
    const id = /\/file\/d\/([A-Za-z0-9_-]{10,})/.exec(url.pathname)?.[1] ?? (url.pathname === "/open" ? url.searchParams.get("id") : null);
    if (id && /^[A-Za-z0-9_-]{10,}$/.test(id)) return `https://drive.google.com/uc?export=download&id=${id}`;
    return null;
  }
  if (host === "dropbox.com" || host === "www.dropbox.com") {
    if (!/^\/(s|scl\/fi)\//.test(url.pathname)) return null;
    url.searchParams.set("dl", "1");
    return url.href;
  }
  return null;
}

interface Tag {
  name: string;
  attrs: Map<string, string>;
  /** For `<a>`: its text, tags removed. */
  text: string;
  index: number;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

function parseAttrs(raw: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    const name = match[1].toLowerCase();
    if (!attrs.has(name)) attrs.set(name, decodeEntities(match[2] ?? match[3] ?? match[4] ?? ""));
  }
  return attrs;
}

/** The tags the finder reads, in document order. Scripts, styles and comments are skipped. */
function tagsOf(html: string): Tag[] {
  const clean = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript)\b[\s\S]*?<\/\1\s*>/gi, " ");
  const tags: Tag[] = [];
  const re = /<(a|iframe|embed|object|source|meta|link|button|div|span|base)\b([^>]*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(clean))) {
    const name = match[1].toLowerCase();
    let text = "";
    if (name === "a" || name === "button") {
      const end = clean.toLowerCase().indexOf(`</${name}`, re.lastIndex);
      if (end > 0 && end - re.lastIndex < 2000) {
        text = decodeEntities(clean.slice(re.lastIndex, end).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
      }
    }
    tags.push({ name, attrs: parseAttrs(match[2]), text, index: match.index });
  }
  return tags;
}

function resolveAgainst(raw: string | undefined, base: string): string | null {
  const value = raw?.trim();
  if (!value || /^(javascript|mailto|tel|data):/i.test(value) || value.startsWith("#")) return null;
  try {
    const url = new URL(value, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function notEnglish(url: string, words: string): boolean {
  if (urlLanguage(url).verdict === "not_english") return true;
  return words.trim().length >= 3 && titleLanguage(words).verdict === "not_english";
}

/**
 * The page's PDF candidates, best first (see the module comment). `landing` is
 * the page the resolver started from, whose site the host rule keeps to (the
 * page itself when it is the first).
 */
export function findPdfCandidates(html: string, pageUrl: string, landing: string = pageUrl): PdfCandidate[] {
  const tags = tagsOf(html);
  const baseHref = tags.find((t) => t.name === "base")?.attrs.get("href");
  const base = resolveAgainst(baseHref, pageUrl) ?? pageUrl;
  const found = new Map<string, PdfCandidate & { order: number }>();

  const add = (raw: string | null, reason: string, score: number, direct: boolean, words: string, order: number) => {
    if (!raw) return;
    const download = directDownloadUrl(raw);
    const url = download ?? raw;
    if (download) {
      score = Math.max(score, raw.includes("file=") ? 95 : 85);
      direct = true;
      reason = raw.includes("file=") ? `${reason} (PDF.js viewer file)` : `${reason} (direct download)`;
    }
    if (!isAllowedHost(url, landing) || notEnglish(url, words)) return;
    if (MANUAL_WORDS.test(words) && score < 100) score += score >= 75 ? 10 : 5;
    const known = found.get(url);
    if (!known || known.score < score) found.set(url, { url, reason, score, direct, order: known?.order ?? order });
  };

  // The page itself may be a viewer or a share link.
  const own = directDownloadUrl(pageUrl);
  if (own) add(own, "the page's own file", 95, true, "", -1);

  tags.forEach((tag, order) => {
    const a = tag.attrs;
    switch (tag.name) {
      case "iframe":
      case "embed":
      case "source": {
        const src = resolveAgainst(a.get("src") ?? a.get("data-src"), base);
        if (src && (isPdfPath(src) || directDownloadUrl(src))) add(src, `<${tag.name}> src`, 90, true, a.get("title") ?? "", order);
        break;
      }
      case "object": {
        const data = resolveAgainst(a.get("data"), base);
        if (data && (isPdfPath(data) || a.get("type") === "application/pdf")) add(data, "<object> data", 90, true, "", order);
        break;
      }
      case "meta": {
        if ((a.get("http-equiv") ?? "").toLowerCase() !== "refresh") break;
        const target = /url\s*=\s*['"]?([^'";]+)/i.exec(a.get("content") ?? "")?.[1];
        add(resolveAgainst(target, base), "meta refresh", 70, isPdfPath(target ?? ""), "", order);
        break;
      }
      case "link": {
        const href = resolveAgainst(a.get("href"), base);
        if (href && (a.get("type") === "application/pdf" || isPdfPath(href))) add(href, "<link> to a PDF", 80, true, a.get("title") ?? "", order);
        break;
      }
      case "a":
      case "button":
      case "div":
      case "span": {
        // `data-*` attributes some viewers and download buttons carry.
        for (const name of ["data-pdf", "data-file", "data-url", "data-href", "data-download", "data-src"]) {
          const value = resolveAgainst(a.get(name), base);
          if (value && (isPdfPath(value) || directDownloadUrl(value))) add(value, `${name} attribute`, 80, true, tag.text, order);
        }
        if (tag.name !== "a") break;
        const href = resolveAgainst(a.get("href"), base);
        if (!href || href === pageUrl) break;
        const words = `${tag.text} ${a.get("title") ?? ""} ${a.get("aria-label") ?? ""}`.trim();
        if (isPdfPath(href) || directDownloadUrl(href)) add(href, "link to a PDF", 80, true, words, order);
        else if (a.has("download")) add(href, "link with a download attribute", 75, true, words, order);
        else if (DOWNLOAD_WORDS.test(words) || /\/(download|downloads|dl)(\/|\?|$)/i.test(new URL(href).pathname + new URL(href).search))
          add(href, `link "${words.slice(0, 40)}"`, 50, false, words, order);
        break;
      }
    }
  });

  return [...found.values()]
    .sort((x, y) => y.score - x.score || x.order - y.order)
    .map(({ url, reason, score, direct }) => ({ url, reason, score, direct }));
}
