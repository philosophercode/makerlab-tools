import { urlLanguage } from "../research/language.ts";
import { guardedFetch, type GuardedFetchResult } from "../web/guarded-fetch.ts";
import { hasPdfMagic } from "../web/pdf-magic.ts";
import { findPdfCandidates, isPdfPath } from "./pdf-links.ts";

/**
 * Resolve a manual link to the PDF itself (manual text spec amendment
 * 2026-09-28 "Follow the download page to the PDF").
 *
 * Given a link research saved as a manual, this opens it; when it answers a
 * PDF, that is the manual. When it answers HTML — a product page with the
 * manual in a viewer, a support article with a Download button, a Drive or
 * Dropbox share — it reads the page's candidates (`pdf-links.ts`) and opens
 * them best first, following a page that is not the file **at most
 * {@link MAX_HOPS} hops** from the one it started on, on that page's own site
 * or a known file host only.
 *
 * **What counts as the PDF:** a 200 whose type is `application/pdf` (or
 * `application/x-pdf`, or a generic binary type on a `.pdf` address or with a
 * `.pdf` attachment name — a CDN's way of saying the same) **and** whose bytes
 * open `%PDF-`. Only the first {@link PEEK_BYTES} are read; a response that
 * declares more than {@link MAX_MANUAL_BYTES} is refused, as the archive would
 * refuse it. An address in another locale (`_DE.pdf`, `/fr-fr/`) is skipped:
 * English only.
 *
 * Every request is the SSRF-guarded GET (`web/guarded-fetch.ts`): the link
 * came from a model reading untrusted pages. Never throws for a network
 * failure; the caller's `signal` aborting is rethrown, so a step's deadline is
 * not reported as "no PDF".
 *
 * Plain Node: step code and the backfill import it.
 */

/** Pages followed beyond the first. */
export const MAX_HOPS = 2;
/** Candidates opened per page. */
export const MAX_CANDIDATES_PER_PAGE = 5;
/** Requests one resolution may make in all. */
export const MAX_REQUESTS = 10;
/** Bytes read of each response: enough for a page's links, and for a PDF's magic. */
export const PEEK_BYTES = 3 * 1024 * 1024;
/** The archive's own limit (`archive.ts`), kept here so step code need not import the archiver. */
export const MAX_MANUAL_BYTES = 25 * 1024 * 1024;
const PER_REQUEST_TIMEOUT_MS = 10_000;
const USER_AGENT = "Mozilla/5.0 (compatible; MakerLabBot/1.0; manual resolver)";

const PDF_TYPES = new Set(["application/pdf", "application/x-pdf", "application/acrobat"]);
const BINARY_TYPES = new Set(["application/octet-stream", "binary/octet-stream", "application/download", "application/force-download"]);

export type ResolvedManual =
  | {
      status: "pdf";
      /** The PDF's address. */
      pdfUrl: string;
      /** The page it was found through; null when the link was the PDF already. */
      landingUrl: string | null;
      /** How it was found ("<iframe> src", "link to a PDF" …). */
      via: string;
      hops: number;
    }
  | { status: "not_found"; reason: string; tried: string[] };

export type Fetcher = (url: string, signal: AbortSignal) => Promise<GuardedFetchResult>;

export interface ResolveOptions {
  signal?: AbortSignal;
  /** The GET; defaults to the SSRF-guarded one. Tests pass their own only to count requests. */
  fetcher?: Fetcher;
}

const defaultFetcher: Fetcher = (url, signal) =>
  guardedFetch(url, {
    signal,
    maxBytes: MAX_MANUAL_BYTES,
    stopAfterBytes: PEEK_BYTES,
    maxRedirects: 5,
    accept: "application/pdf,text/html;q=0.9,*/*;q=0.5",
    userAgent: USER_AGENT,
  });

function mediaType(header: string | null | undefined): string {
  return header?.split(";")[0].trim().toLowerCase() ?? "";
}

/** Whether a response is the PDF (see the module comment). */
export function isPdfResponse(result: Extract<GuardedFetchResult, { ok: true }>): boolean {
  if (!hasPdfMagic(result.bytes)) return false;
  const type = mediaType(result.contentType);
  if (PDF_TYPES.has(type)) return true;
  if (!BINARY_TYPES.has(type) && type !== "") return false;
  const disposition = result.headers.get("content-disposition") ?? "";
  return isPdfPath(result.url) || /filename\*?=[^;]*\.pdf/i.test(disposition);
}

function isHtml(result: Extract<GuardedFetchResult, { ok: true }>): boolean {
  const type = mediaType(result.contentType);
  if (type === "text/html" || type === "application/xhtml+xml") return true;
  if (type) return false;
  return /^\s*(<!doctype html|<html|<head|<body)/i.test(new TextDecoder().decode(result.bytes.subarray(0, 512)));
}

export async function resolveManualPdf(startUrl: string, options: ResolveOptions = {}): Promise<ResolvedManual> {
  const fetcher = options.fetcher ?? defaultFetcher;
  const tried: string[] = [];
  let requests = 0;

  const open = async (url: string) => {
    requests += 1;
    tried.push(url);
    const timeout = AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    const result = await fetcher(url, signal);
    options.signal?.throwIfAborted();
    return result;
  };

  if (urlLanguage(startUrl).verdict === "not_english") return { status: "not_found", reason: "not English", tried };

  const first = await open(startUrl);
  if (!first.ok) {
    return { status: "not_found", reason: first.reason === "too_large" ? "too large" : `could not open (${first.reason}${first.status ? ` ${first.status}` : ""})`, tried };
  }
  if (isPdfResponse(first)) return { status: "pdf", pdfUrl: first.url, landingUrl: null, via: "the link itself", hops: 0 };
  if (!isHtml(first)) return { status: "not_found", reason: `not a page or a PDF (${mediaType(first.contentType) || "no type"})`, tried };

  const landing = first.url;
  const seen = new Set<string>([startUrl, landing]);
  // Breadth first: every candidate of the landing page before any page two hops out.
  let frontier: { html: string; url: string; hops: number }[] = [
    { html: new TextDecoder().decode(first.bytes), url: landing, hops: 0 },
  ];
  while (frontier.length > 0) {
    const next: typeof frontier = [];
    for (const page of frontier) {
      const candidates = findPdfCandidates(page.html, page.url, landing)
        .filter((c) => !seen.has(c.url))
        .slice(0, MAX_CANDIDATES_PER_PAGE);
      for (const candidate of candidates) {
        if (requests >= MAX_REQUESTS) return { status: "not_found", reason: "request limit reached", tried };
        seen.add(candidate.url);
        const result = await open(candidate.url);
        if (!result.ok) continue;
        if (isPdfResponse(result)) {
          if (urlLanguage(result.url).verdict === "not_english") continue;
          return { status: "pdf", pdfUrl: result.url, landingUrl: landing, via: candidate.reason, hops: page.hops + 1 };
        }
        // A page one hop out may be read for candidates two hops out; no further.
        if (page.hops + 1 < MAX_HOPS && isHtml(result)) {
          next.push({ html: new TextDecoder().decode(result.bytes), url: result.url, hops: page.hops + 1 });
        }
      }
    }
    frontier = next;
  }
  return { status: "not_found", reason: "no PDF on the page", tried };
}
