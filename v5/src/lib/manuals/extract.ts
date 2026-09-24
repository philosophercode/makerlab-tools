import { getDocumentProxy } from "unpdf";
import type { ManualOutlineEntry } from "../db/schema/manuals.ts";
import type { ManualDocumentStatus, ManualOutlineSource } from "../db/schema/vocabulary.ts";

/**
 * `extractManual(bytes)` — a manual PDF's text, page by page, and its outline
 * (manual text and search spec §3.2).
 *
 * Deterministic and model-free: what is stored is what the PDF says, so a
 * page citation is always checkable. Runs on **unpdf** (Mozilla's pdf.js,
 * packaged for serverless: no native binaries, no worker).
 *
 * - **Pages.** Each page's text items are rebuilt into lines in content order
 *   (a new line where pdf.js marks an end of line or the baseline moves), a
 *   word broken with a hyphen at a line end is joined, and **running headers
 *   and footers** — a line that opens or closes most pages, digits ignored so
 *   "Page 3" and "Page 4" count as one — are dropped.
 * - **Outline.** The PDF's bookmarks (`getOutline()`), each resolved to the
 *   1-based page it opens (`outline_source = 'pdf'`). Without bookmarks,
 *   headings are **inferred** from font size: short lines clearly larger than
 *   the body text, the largest size level 1 and the rest level 2
 *   (`'inferred'`). Neither: `'none'`.
 * - **Page labels.** The printed label (`getPageLabels()`: "iv", "3-12") is
 *   kept for a page only when it differs from the page's own number.
 * - **Classification.** `ready`; `no_text` when the average page has under
 *   {@link NO_TEXT_MIN_AVG_CHARS} characters (a scan); `failed` with
 *   `encrypted`, `corrupt` or `too_large` (over {@link MANUAL_EXTRACT_MAX_BYTES},
 *   {@link MANUAL_EXTRACT_MAX_PAGES} pages, or {@link MANUAL_EXTRACT_TIMEOUT_MS}).
 *
 * **Hostile input costs at most one failed extraction** (§8): pdf.js is opened
 * with `isEvalSupported: false` (unpdf's serverless build carries no eval path
 * at all; the flag is passed anyway), no font faces, errors-only logging, and
 * the page and time caps above. It never throws: every outcome is a value.
 *
 * Pure apart from pdf.js itself — no database, no network. Plain Node: the
 * index step and research's read step import it.
 */

/** Bump when the extraction changes what is stored; stored documents of an older version are re-processed. */
export const EXTRACTOR_VERSION = "unpdf-1/extract-2";

/** The archive's own limit (`MAX_MANUAL_BYTES` in `archive.ts`). */
export const MANUAL_EXTRACT_MAX_BYTES = 25 * 1024 * 1024;

export const MANUAL_EXTRACT_MAX_PAGES = 1000;

export const MANUAL_EXTRACT_TIMEOUT_MS = 60_000;

/** Below this many characters per page on average, a PDF is a scan (`no_text`). */
export const NO_TEXT_MIN_AVG_CHARS = 100;

/** Most outline entries kept, bookmarks or inferred. */
export const MAX_OUTLINE_ENTRIES = 400;

/** Why a document is `failed` or `no_text`. */
export type ManualExtractReason = "encrypted" | "corrupt" | "too_large" | "no_text_layer";

export interface ExtractedPage {
  /** 1-based PDF page index — what `#page=N` opens. */
  pageNumber: number;
  /** The printed label, when the PDF declares one that differs from `pageNumber`. */
  label: string | null;
  text: string;
}

export interface ExtractedManual {
  status: ManualDocumentStatus;
  reason: ManualExtractReason | null;
  /** Null when the file could not be opened. */
  pageCount: number | null;
  /** Every page, in order, for `ready`; empty otherwise. */
  pages: ExtractedPage[];
  outline: ManualOutlineEntry[];
  /** Null when the file could not be opened. */
  outlineSource: ManualOutlineSource | null;
  /** The PDF's own `/Title`, when it has a usable one. */
  title: string | null;
}

export interface ExtractManualOptions {
  maxBytes?: number;
  maxPages?: number;
  timeoutMs?: number;
}

export async function extractManual(bytes: Uint8Array, options: ExtractManualOptions = {}): Promise<ExtractedManual> {
  const maxBytes = options.maxBytes ?? MANUAL_EXTRACT_MAX_BYTES;
  if (bytes.byteLength === 0) return failed("corrupt");
  if (bytes.byteLength > maxBytes) return failed("too_large");

  const deadline = Date.now() + (options.timeoutMs ?? MANUAL_EXTRACT_TIMEOUT_MS);
  let destroy: () => void = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ExtractedManual>((resolve) => {
    timer = setTimeout(() => {
      destroy();
      resolve(failed("too_large"));
    }, options.timeoutMs ?? MANUAL_EXTRACT_TIMEOUT_MS);
  });

  const run = async (): Promise<ExtractedManual> => {
    let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
    try {
      // pdf.js takes ownership of the buffer it is given; the caller keeps theirs.
      pdf = await getDocumentProxy(new Uint8Array(bytes), {
        isEvalSupported: false,
        disableFontFace: true,
        verbosity: 0,
      } as Parameters<typeof getDocumentProxy>[1]);
    } catch (error) {
      return failed(errorName(error) === "PasswordException" ? "encrypted" : "corrupt");
    }
    destroy = () => {
      void pdf.loadingTask.destroy().catch(() => {});
    };
    try {
      return await read(pdf, options.maxPages ?? MANUAL_EXTRACT_MAX_PAGES, deadline);
    } catch (error) {
      return failed(errorName(error) === "PasswordException" ? "encrypted" : "corrupt");
    } finally {
      destroy();
    }
  };

  try {
    return await Promise.race([run(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;

async function read(pdf: PdfDocument, maxPages: number, deadline: number): Promise<ExtractedManual> {
  const pageCount = pdf.numPages;
  if (pageCount > maxPages) return { ...failed("too_large"), pageCount };

  const rawPages: PageLine[][] = [];
  for (let n = 1; n <= pageCount; n += 1) {
    // pdf.js without a worker runs on microtasks, so a timer alone may never
    // get to fire: check the clock between pages, and let the loop breathe.
    if (Date.now() > deadline) return { ...failed("too_large"), pageCount };
    if (n % 10 === 0) await new Promise((resolve) => setImmediate(resolve));
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    rawPages.push(buildLines(content.items as RawTextItem[]));
    page.cleanup();
  }

  const kept = removeRunningLines(rawPages);
  const texts = kept.map((lines) => pageText(lines));
  const totalChars = texts.reduce((sum, text) => sum + text.replace(/\s+/g, "").length, 0);
  const title = await documentTitle(pdf);

  if (pageCount === 0 || totalChars / pageCount < NO_TEXT_MIN_AVG_CHARS) {
    return { status: "no_text", reason: "no_text_layer", pageCount, pages: [], outline: [], outlineSource: "none", title };
  }

  const labels = await pageLabels(pdf, pageCount);
  const pages = texts.map((text, i) => ({ pageNumber: i + 1, label: labels[i], text }));

  const bookmarks = usableBookmarks(await resolveOutline(pdf, pageCount));
  if (bookmarks.length > 0) {
    return { status: "ready", reason: null, pageCount, pages, outline: bookmarks, outlineSource: "pdf", title };
  }
  const inferred = inferHeadings(kept);
  return {
    status: "ready",
    reason: null,
    pageCount,
    pages,
    outline: inferred,
    outlineSource: inferred.length > 0 ? "inferred" : "none",
    title,
  };
}

// ── Lines ───────────────────────────────────────────────────────────

/** A pdf.js text item, or a marked-content marker (no `str`). */
export interface RawTextItem {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
}

/** One rebuilt line: its text, the largest font size on it, and its baseline. */
export interface PageLine {
  text: string;
  size: number;
  y: number;
}

/**
 * A page's text items as lines, in content order. A line ends where pdf.js
 * marks an end of line or where the next item's baseline is clearly elsewhere;
 * items on one line are joined with a space when there is a visible gap.
 */
export function buildLines(items: readonly RawTextItem[]): PageLine[] {
  const lines: PageLine[] = [];
  let current: { parts: string; size: number; y: number; xEnd: number } | null = null;

  const flush = () => {
    if (!current) return;
    const text = current.parts.replace(/\s+/g, " ").trim();
    if (text) lines.push({ text, size: round(current.size), y: current.y });
    current = null;
  };

  for (const item of items) {
    if (typeof item.str !== "string") continue;
    const t = item.transform ?? [1, 0, 0, 1, 0, 0];
    const size = Math.hypot(t[2] ?? 0, t[3] ?? 0) || item.height || 0;
    const x = t[4] ?? 0;
    const y = t[5] ?? 0;

    if (item.str.length > 0) {
      if (current && Math.abs(y - current.y) > Math.max(2, Math.min(size, current.size) * 0.5)) flush();
      if (!current) {
        current = { parts: item.str, size, y, xEnd: x + (item.width ?? 0) };
      } else {
        const gap = x - current.xEnd;
        const needsSpace =
          !/\s$/.test(current.parts) && !/^\s/.test(item.str) && gap > Math.max(size, current.size) * 0.15;
        current.parts += (needsSpace ? " " : "") + item.str;
        current.size = Math.max(current.size, size);
        current.xEnd = x + (item.width ?? 0);
      }
    }
    if (item.hasEOL) flush();
  }
  flush();
  return lines;
}

/** Lines at a page's edges that are candidates for a running header or footer. */
const EDGE_LINES = 2;

/**
 * Drop running headers and footers: a line among the first or last
 * {@link EDGE_LINES} of a page whose text (digits ignored) opens or closes at
 * least half the pages — and at least three of them. Shorter documents are
 * left as they are: two pages are not enough to tell a header from content.
 */
export function removeRunningLines(pages: readonly PageLine[][]): PageLine[][] {
  if (pages.length < 3) return pages.map((lines) => [...lines]);
  const counts = new Map<string, number>();
  for (const lines of pages) {
    const seen = new Set<string>();
    for (const index of edgeIndexes(lines.length)) seen.add(runningKey(lines[index].text));
    for (const key of seen) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const threshold = Math.max(3, Math.ceil(pages.length / 2));
  const running = new Set([...counts].filter(([key, count]) => key && count >= threshold).map(([key]) => key));

  return pages.map((lines) => {
    const edges = new Set(edgeIndexes(lines.length));
    return lines.filter(
      (line, index) => !(edges.has(index) && (running.has(runningKey(line.text)) || isBarePageNumber(line.text)))
    );
  });
}

/** "12", "- ii -", "iv": a line that is only a page number. */
export function isBarePageNumber(text: string): boolean {
  const core = text.trim().replace(/^[-–—\s]+|[-–—\s]+$/g, "");
  if (/^\d{1,4}$/.test(core)) return true;
  // A well-formed roman numeral up to 399 ("Civic" is not one).
  return core.length > 0 && /^(?:c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})$/i.test(core);
}

function edgeIndexes(length: number): number[] {
  const out = new Set<number>();
  for (let i = 0; i < Math.min(EDGE_LINES, length); i += 1) {
    out.add(i);
    out.add(length - 1 - i);
  }
  return [...out];
}

function runningKey(text: string): string {
  return text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
}

/** A page's kept lines as text, with end-of-line hyphenation joined. */
export function pageText(lines: readonly PageLine[]): string {
  return joinHyphenation(lines.map((line) => line.text).join("\n"))
    .replace(/(?:\s?\.){4,}\s?/g, " … ")
    .trim();
}

/** "calibra-\ntion" → "calibration". Only a letter, a hyphen, a line break and a lower-case letter: "110-\n120" stays. */
export function joinHyphenation(text: string): string {
  return text.replace(/([A-Za-zÀ-ɏ])-\n([a-zß-ɏ])/g, "$1$2");
}

// ── Outline ─────────────────────────────────────────────────────────

interface OutlineNode {
  title: string;
  dest: string | unknown[] | null;
  items: OutlineNode[];
}

/** The PDF's bookmarks with each destination resolved to a 1-based page; entries that resolve nowhere are left out. */
async function resolveOutline(pdf: PdfDocument, pageCount: number): Promise<ManualOutlineEntry[]> {
  let nodes: OutlineNode[] | null;
  try {
    nodes = (await pdf.getOutline()) as OutlineNode[] | null;
  } catch {
    return [];
  }
  const out: ManualOutlineEntry[] = [];
  const walk = async (list: readonly OutlineNode[], level: number) => {
    for (const node of list) {
      if (out.length >= MAX_OUTLINE_ENTRIES) return;
      const title = cleanTitle(node.title);
      const page = await destinationPage(pdf, node.dest).catch(() => null);
      if (title && page !== null && page >= 1 && page <= pageCount) out.push({ title, page, level });
      if (node.items?.length) await walk(node.items, level + 1);
    }
  };
  await walk(nodes ?? [], 1);
  return out;
}

async function destinationPage(pdf: PdfDocument, dest: OutlineNode["dest"]): Promise<number | null> {
  const explicit = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
  if (!Array.isArray(explicit) || explicit.length === 0) return null;
  const target = explicit[0];
  if (typeof target === "number") return target + 1;
  if (target && typeof target === "object") {
    return (await pdf.getPageIndex(target as Parameters<PdfDocument["getPageIndex"]>[0])) + 1;
  }
  return null;
}

/**
 * A bookmark title that is an identifier, not a heading: one word with an
 * underscore — `_tyjcwt` (the anchor ids a Google Docs export writes as
 * bookmarks), `P322_681_eng` (a file name).
 */
export function isJunkBookmark(title: string): boolean {
  return !/\s/.test(title) && title.includes("_");
}

/**
 * The PDF's bookmarks, unless most of them are identifiers — then none, so the
 * headings are inferred instead. The odd identifier among real headings is
 * dropped.
 */
export function usableBookmarks(entries: ManualOutlineEntry[]): ManualOutlineEntry[] {
  const kept = entries.filter((entry) => !isJunkBookmark(entry.title));
  return kept.length >= entries.length / 2 ? kept : [];
}

/** How much larger than body text a line must be to be a heading. */
const HEADING_RATIO = 1.2;
/** Longest line taken for a heading. */
const HEADING_MAX_CHARS = 100;

/** At most this many inferred headings per page on average; beyond it only the larger sizes are kept. */
const HEADINGS_PER_PAGE = 1.5;

/**
 * Headings inferred from font size, for a PDF without (usable) bookmarks.
 *
 * - The **body size** is the size most characters are set in.
 * - A **candidate** is a line at least {@link HEADING_RATIO}× that size, with
 *   at least three letters, at most {@link HEADING_MAX_CHARS} characters and
 *   twelve words, that does not end like a sentence (`.`, `,`, `;`). Two
 *   consecutive candidate lines of one size on one page are one heading set
 *   on two lines ("IMPORTANT SAFETY" / "INFORMATION"), joined.
 * - **Density.** A manual whose body has many slightly larger lines (callouts,
 *   warnings) would otherwise yield hundreds: sizes are taken largest first
 *   while the total stays within {@link HEADINGS_PER_PAGE} a page (the largest
 *   size is always kept).
 * - **Levels** follow the sizes headings are set in more than once: the
 *   largest is 1, the next 2, any smaller 3 (left out of what the tool page
 *   and research show). A size used for one line only — a cover title — is
 *   level 1 and does not push the chapters down.
 */
export function inferHeadings(pages: readonly PageLine[][]): ManualOutlineEntry[] {
  const charsBySize = new Map<number, number>();
  for (const lines of pages) {
    for (const line of lines) charsBySize.set(line.size, (charsBySize.get(line.size) ?? 0) + line.text.length);
  }
  if (charsBySize.size === 0) return [];
  const bodySize = [...charsBySize].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  if (bodySize <= 0) return [];

  const candidates: { title: string; page: number; size: number }[] = [];
  pages.forEach((lines, index) => {
    let previous: { lineIndex: number; size: number } | null = null;
    lines.forEach((line, lineIndex) => {
      const title = cleanTitle(line.text);
      const isCandidate =
        line.size >= bodySize * HEADING_RATIO &&
        title.length <= HEADING_MAX_CHARS &&
        (title.match(/\p{L}/gu)?.length ?? 0) >= 3 &&
        title.split(" ").length <= 12 &&
        !/[.,;]$/.test(title);
      if (!isCandidate) {
        previous = null;
        return;
      }
      const last = candidates[candidates.length - 1];
      if (
        previous &&
        previous.lineIndex === lineIndex - 1 &&
        previous.size === line.size &&
        last &&
        last.page === index + 1 &&
        last.title.length + title.length < HEADING_MAX_CHARS
      ) {
        last.title = `${last.title} ${title}`;
      } else {
        candidates.push({ title, page: index + 1, size: line.size });
      }
      previous = { lineIndex, size: line.size };
    });
  });
  if (candidates.length === 0) return [];

  const sizes = [...new Set(candidates.map((c) => c.size))].sort((a, b) => b - a);
  const budget = Math.max(10, Math.ceil(pages.length * HEADINGS_PER_PAGE));
  const kept: number[] = [];
  let total = 0;
  for (const size of sizes) {
    const count = candidates.filter((c) => c.size === size).length;
    if (kept.length > 0 && total + count > budget) break;
    kept.push(size);
    total += count;
  }
  // Levels come from the sizes headings are set in repeatedly: a size used once
  // is a cover title or a one-off banner, and must not push every chapter down.
  const chosen = candidates.filter((c) => kept.includes(c.size));
  const repeated = kept.filter((size) => chosen.filter((c) => c.size === size).length > 1);
  const levelOf = (size: number) => (repeated.includes(size) ? Math.min(3, repeated.indexOf(size) + 1) : 1);
  return chosen.slice(0, MAX_OUTLINE_ENTRIES).map(({ title, page, size }) => ({ title, page, level: levelOf(size) }));
}

// ── Labels and title ────────────────────────────────────────────────

async function pageLabels(pdf: PdfDocument, pageCount: number): Promise<(string | null)[]> {
  let labels: string[] | null = null;
  try {
    labels = await pdf.getPageLabels();
  } catch {
    labels = null;
  }
  return Array.from({ length: pageCount }, (_, i) => {
    const label = labels?.[i]?.trim();
    return label && label !== String(i + 1) ? label.slice(0, 40) : null;
  });
}

async function documentTitle(pdf: PdfDocument): Promise<string | null> {
  try {
    const meta = await pdf.getMetadata();
    const title = (meta.info as { Title?: unknown } | undefined)?.Title;
    return typeof title === "string" ? cleanTitle(title) || null : null;
  } catch {
    return null;
  }
}

function cleanTitle(raw: string | null | undefined): string {
  return (raw ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
}

// ── Outcomes ────────────────────────────────────────────────────────

function failed(reason: Exclude<ManualExtractReason, "no_text_layer">): ExtractedManual {
  return { status: "failed", reason, pageCount: null, pages: [], outline: [], outlineSource: null, title: null };
}

function errorName(error: unknown): string {
  return error && typeof error === "object" && "name" in error ? String((error as { name: unknown }).name) : "";
}

function round(size: number): number {
  return Math.round(size * 2) / 2;
}
