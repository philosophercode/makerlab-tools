import { guardedFetch, type GuardedFetchResult } from "./guarded-fetch.ts";
import { extractPage } from "./html-text.ts";

/**
 * The server-side page reader (gateway spec §3.3), in place of Anthropic's
 * `web_fetch` — one module, two callers: chat's `read_page` capability and the
 * research read step.
 *
 * It fetches through {@link guardedFetch} (http(s) only, private addresses
 * refused at every hop, three redirects, streamed size caps) inside a 15-second
 * budget of its own, combined with the caller's signal, and answers:
 *
 * - **HTML / XHTML / plain text** → readable `text` (capped at 40k characters)
 *   and the product images the page declares, attributed to the final URL;
 * - **a PDF** (`application/pdf`, or a body that starts `%PDF-`) → its bytes in
 *   `pdf`, `text` null — the caller decides whether a model gets it as a file;
 * - **anything else** → `unsupported`.
 *
 * It never throws for an expected failure: blocked, failed, too large and
 * unsupported are all results, with a short `reason`.
 *
 * Plain Node: step code imports this.
 */

export const READ_PAGE_MAX_CHARS = 40_000;
export const READ_PAGE_MAX_HTML_BYTES = 5 * 1024 * 1024;
export const READ_PAGE_MAX_PDF_BYTES = 10 * 1024 * 1024;
export const READ_PAGE_TIMEOUT_MS = 15_000;
export const READ_PAGE_MAX_REDIRECTS = 3;

/**
 * An image a page (or Exa) says shows the product, and where that was said.
 * `gallery` is a large picture in the page's own content (its product gallery),
 * not one it declared in metadata.
 */
export interface ImageHint {
  url: string;
  source: "og" | "twitter" | "jsonld" | "gallery" | "exa";
  pageUrl: string | null;
}

export interface ReadPageResult {
  /** The final URL, after redirects. */
  url: string;
  status: "ok" | "blocked" | "failed" | "too_large" | "unsupported";
  contentType: string | null;
  title: string | null;
  /** Readable text, capped at {@link READ_PAGE_MAX_CHARS}. Null for a PDF or a failure. */
  text: string | null;
  /** The PDF's bytes, for `application/pdf`. */
  pdf: Uint8Array | null;
  images: ImageHint[];
  reason?: string;
}

const HTMLISH = new Set(["text/html", "application/xhtml+xml", "text/plain", "application/xml", "text/xml"]);
const ACCEPT = "text/html,application/xhtml+xml,application/pdf;q=0.9,text/plain;q=0.8,*/*;q=0.1";

export interface ReadPageOptions {
  signal: AbortSignal;
  allowedHosts?: readonly string[];
  /**
   * The largest PDF read, default {@link READ_PAGE_MAX_PDF_BYTES}. Research
   * raises it to the manual archive's 25 MB, because it now extracts a manual's
   * text itself (manual text spec §3.7).
   */
  maxPdfBytes?: number;
  /** The whole read's budget, default {@link READ_PAGE_TIMEOUT_MS}. */
  timeoutMs?: number;
}

export async function readPage(url: string, opts: ReadPageOptions): Promise<ReadPageResult> {
  const maxPdfBytes = opts.maxPdfBytes ?? READ_PAGE_MAX_PDF_BYTES;
  // setTimeout rather than AbortSignal.timeout, so a test's fake clock drives it.
  const deadline = new AbortController();
  const timer = setTimeout(
    () => deadline.abort(new DOMException("The page took too long to answer.", "TimeoutError")),
    opts.timeoutMs ?? READ_PAGE_TIMEOUT_MS
  );
  const signal = AbortSignal.any([opts.signal, deadline.signal]);

  try {
    const fetched = await guardedFetch(url, {
      signal,
      maxBytes: Math.max(maxPdfBytes, READ_PAGE_MAX_HTML_BYTES),
      maxBytesFor: (type) => (type !== null && HTMLISH.has(type) ? READ_PAGE_MAX_HTML_BYTES : maxPdfBytes),
      allowedHosts: opts.allowedHosts,
      accept: ACCEPT,
      maxRedirects: READ_PAGE_MAX_REDIRECTS,
    });
    if (!fetched.ok) return failure(fetched);
    return interpret(fetched);
  } catch {
    return empty(url, "failed", null, "unexpected");
  } finally {
    clearTimeout(timer);
  }
}

function interpret(fetched: Extract<GuardedFetchResult, { ok: true }>): ReadPageResult {
  const { url, bytes, contentType } = fetched;
  const type = contentType?.split(";")[0].trim().toLowerCase() || null;

  if (type === "application/pdf" || startsWithPdfMagic(bytes)) {
    return { url, status: "ok", contentType, title: null, text: null, pdf: bytes, images: [] };
  }

  const markup = type === null && looksLikeMarkup(bytes);
  if (!(type !== null && HTMLISH.has(type)) && !markup) {
    return empty(url, "unsupported", contentType, type ?? "unknown_type");
  }
  // An unlabelled body is allowed only the HTML cap, whatever it was read under.
  if (bytes.byteLength > READ_PAGE_MAX_HTML_BYTES) return empty(url, "too_large", contentType, "html_over_cap");

  const decoded = decode(bytes, contentType);
  // Plain text that is really a page (a mislabelled server) is read as a page.
  if (type === "text/plain" && !looksLikeMarkup(bytes)) {
    const text = decoded.replace(/[ \t\f\v\r]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
    return { url, status: "ok", contentType, title: null, text: cap(text), pdf: null, images: [] };
  }

  const page = extractPage(decoded, url);
  return { url, status: "ok", contentType, title: page.title, text: cap(page.text), pdf: null, images: page.images };
}

function failure(fetched: Extract<GuardedFetchResult, { ok: false }>): ReadPageResult {
  switch (fetched.reason) {
    case "blocked":
      return empty(fetched.url, "blocked", null, fetched.detail ?? "blocked");
    case "too_large":
      return empty(fetched.url, "too_large", null, "too_large");
    case "unsupported":
      return empty(fetched.url, "unsupported", null, fetched.detail ?? "unsupported");
    case "http_error":
      return empty(fetched.url, "failed", null, `http_${fetched.status ?? "error"}`);
    case "timeout":
      return empty(fetched.url, "failed", null, "timeout");
    default:
      return empty(fetched.url, "failed", null, fetched.detail ?? "failed");
  }
}

function empty(url: string, status: ReadPageResult["status"], contentType: string | null, reason: string): ReadPageResult {
  return { url, status, contentType, title: null, text: null, pdf: null, images: [], reason };
}

function cap(text: string): string {
  return text.length > READ_PAGE_MAX_CHARS ? text.slice(0, READ_PAGE_MAX_CHARS) : text;
}

function startsWithPdfMagic(bytes: Uint8Array): boolean {
  // "%PDF-", allowing the leading whitespace some servers send.
  let i = 0;
  while (i < bytes.length && i < 16 && (bytes[i] === 0x20 || bytes[i] === 0x0a || bytes[i] === 0x0d || bytes[i] === 0x09)) i += 1;
  return (
    bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 && bytes[i + 3] === 0x46 && bytes[i + 4] === 0x2d
  );
}

function looksLikeMarkup(bytes: Uint8Array): boolean {
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 512)).trimStart().toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html") || head.startsWith("<head") || head.startsWith("<body");
}

/** Decode with the charset the header names, else a `<meta charset>`, else UTF-8. */
function decode(bytes: Uint8Array, contentType: string | null): string {
  const fromHeader = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType ?? "")?.[1];
  const sniffed = fromHeader
    ? undefined
    : /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(new TextDecoder("latin1").decode(bytes.subarray(0, 2048)))?.[1];
  for (const label of [fromHeader, sniffed, "utf-8"]) {
    if (!label) continue;
    try {
      return new TextDecoder(label, { fatal: false }).decode(bytes);
    } catch {
      // An unknown label: try the next.
    }
  }
  return new TextDecoder().decode(bytes);
}
