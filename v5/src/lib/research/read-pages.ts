import type { ModelMessage } from "ai";
import type { CategoryOption } from "../data/taxonomy.ts";
import {
  RESEARCH_ATTACH_PDFS,
  RESEARCH_MANUAL_TEXT_MAX_CHARS,
  RESEARCH_MAX_PAGE_READS,
  RESEARCH_MAX_PDFS_READ,
} from "../intake/limits.ts";
import type { ResearchFocus } from "../intake/research-focus.ts";
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
 *   and flex tier for research"), while {@link RESEARCH_ATTACH_PDFS} is off: a
 *   PDF the server read is given to the model as the text the search captured
 *   for that URL, capped at {@link RESEARCH_MANUAL_TEXT_MAX_CHARS} and marked
 *   `via: "manual"`. There is no PDF text extractor in the tree, so a PDF the
 *   search captured no text for is skipped and recorded as a failure. At most
 *   `maxPdfs` manuals are given either way.
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
}

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

  const results = await inOrder(targets, READ_CONCURRENCY, async (url): Promise<ReadPageResult> => {
    try {
      return await read(url, { signal: opts.signal, allowedHosts: opts.allowedHosts });
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

  for (const [n, result] of results.entries()) {
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
      // Text, not a file: the search's copy of this PDF, capped. No extractor
      // runs on the bytes, so without a copy the manual is not read.
      if (manualTexts >= maxPdfs) {
        out.failures.push(`${host}: skipped (PDF limit)`);
        continue;
      }
      const copy = findSearchText(targets[n], searchTexts) ?? findSearchText(result.url, searchTexts);
      if (!copy || usedSearchTexts.has(copy.url)) {
        out.failures.push(`${host}: skipped (PDF, no text)`);
        continue;
      }
      usedSearchTexts.add(copy.url);
      manualTexts += 1;
      out.pages.push({
        url: result.url,
        title: copy.title ?? result.title,
        text: capManualText(copy.text),
        via: "manual",
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
async function inOrder<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]);
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
