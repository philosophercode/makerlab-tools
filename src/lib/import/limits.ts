/**
 * The numbers bulk intake runs on (bulk intake spec §2, §3, §4.2, §8).
 *
 * Client-safe and plain Node, like `intake/limits.ts`: the review table says
 * "up to 500" from the same constant the route enforces.
 */

/** The largest text or CSV/TSV file an import reads (§8: "CSV/TSV/text ≤ 5 MB"). */
export const IMPORT_MAX_TEXT_BYTES = 5 * 1024 * 1024;

/** The largest PDF an import reads (§8: "PDF ≤ 20 MB") — the upload route's own PDF cap. */
export const IMPORT_MAX_PDF_BYTES = 20 * 1024 * 1024;

/**
 * The most items one import creates. The review table is built for 500 (§2);
 * a sheet, list or document past this is refused with the count, never
 * silently cut.
 */
export const IMPORT_MAX_ITEMS = 1000;

/**
 * The `parse_error` a document import that named more than {@link IMPORT_MAX_ITEMS}
 * items fails with — a code with the count, which the page words (never English
 * stored as data).
 */
export function tooManyItemsReason(count: number): string {
  return `too_many_items:${count}`;
}

/** The count in a {@link tooManyItemsReason}, or null for any other reason. */
export function parseTooManyItemsReason(reason: string): number | null {
  const match = /^too_many_items:(\d+)$/.exec(reason);
  return match ? Number(match[1]) : null;
}

/**
 * The most characters of a document one import reads — about 25 model calls.
 * A longer document is **refused before any model call**, with its size in
 * pages, and the person is asked to split it (amendment 2026-09-24) — never
 * cut to fit.
 */
export const IMPORT_DOCUMENT_MAX_CHARS = 200_000;

/**
 * Characters on a page of dense text, for saying a size in pages ("about 85
 * pages") rather than characters. An estimate, and the messages say "about".
 */
export const IMPORT_CHARS_PER_PAGE = 3_300;

/** {@link IMPORT_DOCUMENT_MAX_CHARS} in pages: about 60. */
export const IMPORT_DOCUMENT_MAX_PAGES = Math.floor(IMPORT_DOCUMENT_MAX_CHARS / IMPORT_CHARS_PER_PAGE);

/** A length of text as about how many pages, at least one. */
export function approxPages(chars: number): number {
  return Math.max(1, Math.round(chars / IMPORT_CHARS_PER_PAGE));
}

/**
 * Why a document is too long to import, with the numbers the message needs —
 * or null when it fits. A document over the limit by less than half a page
 * still says one page more than the limit, never "about 60 pages; the limit
 * is about 60".
 */
export function documentTooLong(chars: number): { pages: number; limitPages: number; limitChars: number } | null {
  if (chars <= IMPORT_DOCUMENT_MAX_CHARS) return null;
  return {
    pages: Math.max(approxPages(chars), IMPORT_DOCUMENT_MAX_PAGES + 1),
    limitPages: IMPORT_DOCUMENT_MAX_PAGES,
    limitChars: IMPORT_DOCUMENT_MAX_CHARS,
  };
}

/** One extractor call's share of a document (§3.2: "chunked at about 8k characters"). */
export const IMPORT_CHUNK_CHARS = 8_000;

/** A pasted or typed list longer than this many lines goes to an import, not `identify_tools` (§3.5). */
export const IMPORT_CHAT_LINE_THRESHOLD = 15;

/** Quantity of one row (§3.2: "Quantity is 1–50"). */
export const IMPORT_MAX_QUANTITY = 50;

/** Lab documents and product links one item may carry. */
export const IMPORT_MAX_LINKS_PER_ITEM = 10;

/** Rows the mapping step previews (§5 step 1: "the first 10 rows"). */
export const IMPORT_PREVIEW_ROWS = 10;

/** Items per Research request from the review table — the research route's own ceiling. */
export const IMPORT_RESEARCH_CHUNK = 25;

/** Items one Suggest names press may send, and how many run at once (§3.3: "5 at a time"). */
export const SUGGEST_MAX_ITEMS = 100;
export const SUGGEST_CONCURRENCY = 5;

/**
 * What one suggested name costs against the research allowance (§3.3: "a
 * quarter of an item each"), as ledger rows: four suggestions cost one.
 */
export const SUGGEST_ITEMS_PER_LEDGER_ROW = 4;

/** Above this many rows the review table renders a window of them (§6: "virtualized above 200 rows"). */
export const IMPORT_VIRTUALIZE_ABOVE = 200;

/** The setup allowance a super admin grants by default (§11 question 2: "+400 items for 7 days"). */
export const SETUP_ALLOWANCE_DEFAULT_ITEMS = 400;
export const SETUP_ALLOWANCE_DEFAULT_DAYS = 7;

/** The largest single grant — a typo of an extra zero should not be a year of research. */
export const SETUP_ALLOWANCE_MAX_ITEMS = 2000;
export const SETUP_ALLOWANCE_MAX_DAYS = 30;

/** How often the import page asks again while a document is being read. */
export const IMPORT_POLL_INTERVAL_MS = 3_000;
