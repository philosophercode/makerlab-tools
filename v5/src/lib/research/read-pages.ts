import type { ModelMessage } from "ai";
import type { CategoryOption } from "../data/taxonomy.ts";
import {
  RESEARCH_ATTACH_PDFS,
  RESEARCH_MANUAL_TEXT_MAX_CHARS,
  RESEARCH_MAX_PAGE_READS,
  RESEARCH_MAX_PDFS_READ,
} from "../intake/limits.ts";
import type { ResearchFocus } from "../intake/research-focus.ts";
import { manualDigest, type DigestSource } from "../manuals/digest.ts";
import { extractManual, MANUAL_EXTRACT_MAX_BYTES, type ExtractedManual } from "../manuals/extract.ts";
import { readPage, type ImageHint, type ReadPageResult } from "../web/read-page.ts";
import type { SearchFindings } from "./model-output.ts";
import { buildReadPrompt, type ResearchItemInput } from "./prompt.ts";
import { findSearchText, usesSearchText, type SearchPageText } from "./search-text.ts";
import { orderPagesForReading, type PageSubject } from "./source-pages.ts";

/**
 * The read step's server-side reading (gateway spec §3.3 "In research, the
 * read step no longer gives the model a tool", §5.1 step 2).
 *
 * The search step names the pages worth reading; this module reads the first
 * few of them itself, through `readPage` (http(s) only, private addresses
 * refused at every hop, size and time caps), and turns what came back into the
 * one message the tool-less read model receives. Pure orchestration: the
 * reader is injectable, and nothing here calls a model or touches the database.
 *
 * - **Bounded.** At most `max` pages ({@link RESEARCH_MAX_PAGE_READS}) are
 *   attempted — a failed read spends its place, so an item never costs more
 *   than four GETs — two at a time, and at most `maxPdfs`
 *   ({@link RESEARCH_MAX_PDFS_READ}) PDFs are kept.
 * - **In candidate order.** The search prompt asks for the manufacturer's page
 *   and the manual first; results come back in that order whatever order the
 *   reads finish in.
 * - **Failures are recorded, not thrown.** Each is `"<host>: <status>"` — the
 *   host only, never a path or a query, which can carry a session id or a
 *   search term somebody typed — for the prompt (so the model does not claim a
 *   page it never saw) and for the step's log line.
 * - **Image hints** are the product images the pages declared (`og:image`,
 *   `twitter:image`, JSON-LD `Product.image`), attributed to the page's final
 *   URL, de-duplicated, in page order. The image stage takes them from here.
 * - **The search's copy stands in for a page the server could not read**
 *   (amendment "Search text fallback and confidence cap"): a 403 bot challenge,
 *   a 429, a timeout, or a page with no text, when the search captured that
 *   page's text (`search-text.ts`). The page is marked `via: "search"`, and the
 *   prompt labels it "text captured by search". No GET is added: the attempt
 *   already spent its place.
 * - **A manual is read as its text, not attached** (amendment "Manuals as text
 *   and flex tier for research"), while {@link RESEARCH_ATTACH_PDFS} is off, and
 *   **our own extraction comes first** (manual text spec §3.7): a manual the lab
 *   already stores as text (`storedManual`, looked up by URL before anything is
 *   downloaded) is given as its outline and the pages richest in specs; a PDF
 *   the server downloads (up to the archive's 25 MB) is extracted in memory
 *   (`manuals/extract.ts`) and given the same way. Only when neither yields text
 *   — a scan, an encrypted file, too large — does the search's captured copy
 *   stand in, capped at {@link RESEARCH_MANUAL_TEXT_MAX_CHARS}. All three are
 *   marked `via: "manual"`, with `manualSource` saying which. At most `maxPdfs`
 *   manuals are given either way.
 *
 * Plain Node: step code imports this.
 */

/**
 * A page read as text. `url` is the final URL, after redirects — or, for the
 * search's copy, the URL the search captured it from.
 */
export interface ReadPageText {
  url: string;
  title: string | null;
  text: string;
  /**
   * `"search"` when the server could not read the page and this is the text the
   * search captured; `"manual"` when the page is a PDF manual given as its text
   * (the search's copy of it, capped) instead of as a file.
   */
  via?: "search" | "manual";
  /**
   * For `via: "manual"`: where the text came from — `"stored"` (the lab's own
   * processed copy), `"pdf"` (extracted from the file just downloaded) or
   * `"search"` (the search's captured copy, the fallback).
   */
  manualSource?: "stored" | "pdf" | "search";
}

/** A PDF read whole, for a file part. */
export interface ReadPdf {
  url: string;
  data: Uint8Array;
}

export interface ReadPagesResult {
  pages: ReadPageText[];
  pdfs: ReadPdf[];
  imageHints: ImageHint[];
  /** `"<host>: <status>"` (with the reader's short reason code), one per page that gave nothing. */
  failures: string[];
}

export interface ReadCandidatePagesOptions {
  signal: AbortSignal;
  /** The hosts every hop must stay on — the hosts of the search's candidates and sources. */
  allowedHosts: readonly string[];
  /** Pages attempted. Default {@link RESEARCH_MAX_PAGE_READS}. */
  max?: number;
  /** PDFs kept. Default {@link RESEARCH_MAX_PDFS_READ}. */
  maxPdfs?: number;
  /** The reader; `readPage` unless a test passes its own. */
  read?: typeof readPage;
  /** The page texts the search captured — the fallback for a page the server cannot read. */
  searchTexts?: readonly SearchPageText[];
  /**
   * Keep a PDF's bytes for a file part (`true`), or give the model the
   * search's text of it instead (`false`). Default {@link RESEARCH_ATTACH_PDFS}.
   */
  attachPdfs?: boolean;
  /**
   * The lab's stored text of the manual at a URL (its source link or its
   * archived copy), or null. Looked up before a target is fetched: a manual the
   * lab already processed is not downloaded again. Absent: nothing is stored.
   */
  storedManual?: (url: string) => Promise<DigestSource | null>;
  /** The extractor for a downloaded PDF; {@link extractManual} with {@link RESEARCH_PDF_EXTRACT_TIMEOUT_MS} unless a test passes its own. */
  extract?: (bytes: Uint8Array) => Promise<ExtractedManual>;
}

/** How long research gives pdf.js to extract one manual — well inside the read step's 240 s. */
export const RESEARCH_PDF_EXTRACT_TIMEOUT_MS = 30_000;

/** A target that names a PDF is given the manual archive's download time, not a page's 15 s. */
export const RESEARCH_PDF_READ_TIMEOUT_MS = 30_000;

/** Reads in flight at once: enough to overlap two slow servers, few enough to be polite. */
export const READ_CONCURRENCY = 2;

/**
 * The URLs worth reading from what the search found: its candidate links (most
 * useful first, as the prompt asked), then any source it relied on that is not
 * already one. http(s) only, each once, at most `max`.
 *
 * **The manufacturer's product page is always read when the search found one**
 * (amendment "Product-page first"): given the item's brand and name, the first
 * link on the brand's own domain that looks like a product or specs page —
 * not a manual, wiki, support or forum page — moves to the front, and videos
 * move behind every other page (`source-pages.ts`). Without a subject, or when
 * nothing matches, the model's order stands.
 */
export function candidatePageUrls(
  findings: SearchFindings,
  max = RESEARCH_MAX_PAGE_READS,
  subject: PageSubject = { brand: null, name: null }
): string[] {
  const all = [...findings.candidateLinks.map((link) => link.url), ...findings.sourceUrls];
  return orderPagesForReading(all, { brand: subject.brand, name: subject.name || findings.canonicalName }, max);
}

/** Read `urls` (the first `max` of them), two at a time, and sort what came back. */
export async function readCandidatePages(
  urls: readonly string[],
  opts: ReadCandidatePagesOptions
): Promise<ReadPagesResult> {
  const max = opts.max ?? RESEARCH_MAX_PAGE_READS;
  const maxPdfs = opts.maxPdfs ?? RESEARCH_MAX_PDFS_READ;
  const attachPdfs = opts.attachPdfs ?? RESEARCH_ATTACH_PDFS;
  const read = opts.read ?? readPage;
  const targets = urls.slice(0, Math.max(0, max));

  // A manual the lab has already processed is used as stored, not downloaded.
  const stored = await Promise.all(
    targets.map(async (url) => (opts.storedManual ? await opts.storedManual(url).catch(() => null) : null))
  );

  const results = await inOrder(targets, READ_CONCURRENCY, async (url, index): Promise<ReadPageResult | null> => {
    if (stored[index]) return null;
    try {
      return await read(url, {
        signal: opts.signal,
        allowedHosts: opts.allowedHosts,
        maxPdfBytes: MANUAL_EXTRACT_MAX_BYTES,
        ...(looksLikePdfUrl(url) ? { timeoutMs: RESEARCH_PDF_READ_TIMEOUT_MS } : {}),
      });
    } catch {
      // readPage does not throw for an expected failure; a reader that does is one failed page, not a failed step.
      return { url, status: "failed", contentType: null, title: null, text: null, pdf: null, images: [], reason: "unexpected" };
    }
  });

  const out: ReadPagesResult = { pages: [], pdfs: [], imageHints: [], failures: [] };
  const seenImages = new Set<string>();
  const searchTexts = opts.searchTexts ?? [];
  const usedSearchTexts = new Set<string>();
  let manualTexts = 0;
  const extract =
    opts.extract ?? ((bytes: Uint8Array) => extractManual(bytes, { timeoutMs: RESEARCH_PDF_EXTRACT_TIMEOUT_MS }));

  for (const [n, result] of results.entries()) {
    const storedManual = stored[n];
    if (storedManual || !result) {
      if (!storedManual) continue;
      if (manualTexts >= maxPdfs) {
        out.failures.push(`${hostOf(targets[n]) ?? "(unknown host)"}: skipped (PDF limit)`);
        continue;
      }
      manualTexts += 1;
      out.pages.push({
        url: targets[n],
        title: null,
        text: manualDigest(storedManual, RESEARCH_MANUAL_TEXT_MAX_CHARS),
        via: "manual",
        manualSource: "stored",
      });
      continue;
    }
    const host = hostOf(result.url) ?? hostOf(targets[n]) ?? "(unknown host)";

    // A page's declared images count even when its body text is thin.
    for (const hint of result.status === "ok" ? result.images : []) {
      if (seenImages.has(hint.url)) continue;
      seenImages.add(hint.url);
      out.imageHints.push(hint);
    }

    // The server could not read it; the search may have. One copy is used once,
    // however many of the targets are variants of its page.
    if (usesSearchText(result)) {
      const copy = findSearchText(targets[n], searchTexts);
      if (copy && !usedSearchTexts.has(copy.url)) {
        usedSearchTexts.add(copy.url);
        out.pages.push({ url: copy.url, title: copy.title, text: copy.text, via: "search" });
        continue;
      }
    }

    if (result.status !== "ok") {
      out.failures.push(`${host}: ${result.status}${result.reason ? ` (${result.reason})` : ""}`);
      continue;
    }

    if (result.pdf) {
      if (attachPdfs) {
        if (out.pdfs.length < maxPdfs) out.pdfs.push({ url: result.url, data: result.pdf });
        else out.failures.push(`${host}: skipped (PDF limit)`);
        continue;
      }
      // Text, not a file. Our own extraction first: the outline and the pages
      // richest in specs. The search's copy only when the PDF gave no text.
      if (manualTexts >= maxPdfs) {
        out.failures.push(`${host}: skipped (PDF limit)`);
        continue;
      }
      const extracted = await extract(result.pdf).catch(() => null);
      if (extracted?.status === "ready") {
        manualTexts += 1;
        out.pages.push({
          url: result.url,
          title: extracted.title,
          text: manualDigest(extracted, RESEARCH_MANUAL_TEXT_MAX_CHARS),
          via: "manual",
          manualSource: "pdf",
        });
        continue;
      }
      const copy = findSearchText(targets[n], searchTexts) ?? findSearchText(result.url, searchTexts);
      if (!copy || usedSearchTexts.has(copy.url)) {
        const why = extracted?.status === "no_text" ? "scanned" : extracted?.reason ?? "unreadable";
        out.failures.push(`${host}: skipped (PDF ${why}, no text)`);
        continue;
      }
      usedSearchTexts.add(copy.url);
      manualTexts += 1;
      out.pages.push({
        url: result.url,
        title: copy.title ?? result.title,
        text: capManualText(copy.text),
        via: "manual",
        manualSource: "search",
      });
      continue;
    }

    const text = result.text?.trim() ?? "";
    if (text) out.pages.push({ url: result.url, title: result.title, text });
    else out.failures.push(`${host}: empty`);
  }
  return out;
}

/** A manual's text cut to {@link RESEARCH_MANUAL_TEXT_MAX_CHARS}, at a line or word break when one is near. */
export function capManualText(text: string, max = RESEARCH_MANUAL_TEXT_MAX_CHARS): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max);
  const lastBreak = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(" "));
  return `${(lastBreak > max * 0.9 ? cut.slice(0, lastBreak) : cut).trimEnd()} …[manual text cut]`;
}

/** True when a URL's path names a PDF (`….pdf`), query and fragment ignored. */
export function looksLikePdfUrl(raw: string): boolean {
  try {
    return new URL(raw).pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}

/** The manuals given to the model as their text, not as files. */
export function manualTextUrls(read: Pick<ReadPagesResult, "pages">): string[] {
  return read.pages.filter((page) => page.via === "manual").map((page) => page.url);
}

/** The pages whose text came from the search's copy rather than the server's own read. */
export function searchTextUrls(read: Pick<ReadPagesResult, "pages">): string[] {
  return read.pages.filter((page) => page.via === "search").map((page) => page.url);
}

/**
 * The URLs actually read — pages with text and PDFs kept, in candidate order.
 * A page read through the search's copy counts: its text is what the model had.
 * This, not what the model says it relied on, is the result's `sourceUrls`: the
 * model can only have relied on what it was given.
 */
export function readSourceUrls(read: Pick<ReadPagesResult, "pages" | "pdfs">): string[] {
  return [...new Set([...read.pages.map((page) => page.url), ...read.pdfs.map((pdf) => pdf.url)])];
}

/**
 * The read model's one message: the prompt, with every page's text fenced as
 * untrusted data and labelled with its URL (`buildReadPrompt`), then each PDF as
 * a plain file part — no provider options, in the order the prompt lists them.
 * With {@link RESEARCH_ATTACH_PDFS} off, `pdfs` is empty and there is no file
 * part: a manual is among the pages, as its text.
 */
export function buildReadMessages(
  item: ResearchItemInput,
  findings: SearchFindings,
  read: Pick<ReadPagesResult, "pages" | "pdfs" | "failures">,
  categories: readonly CategoryOption[],
  reviewerNote?: string | null,
  focus: ResearchFocus = null
): ModelMessage[] {
  return [
    {
      role: "user",
      content: [
        { type: "text", text: buildReadPrompt(item, findings, read, categories, reviewerNote, focus) },
        ...read.pdfs.map((pdf) => ({ type: "file" as const, mediaType: "application/pdf", data: pdf.data })),
      ],
    },
  ];
}

/** `fn` over `items`, at most `limit` at a time, results in the items' order. */
async function inOrder<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function hostOf(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).hostname || null;
  } catch {
    return null;
  }
}
