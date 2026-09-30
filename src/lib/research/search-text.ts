import type { SearchPageText } from "../ai/exa.ts";

export type { SearchPageText } from "../ai/exa.ts";

/**
 * The read step's fallback: page text the search already captured (amendment
 * "Search text fallback and confidence cap").
 *
 * bambulab.com answers our server-side reader with a bot challenge (403) most
 * of the time, so whether the X2D product page was read was luck; the runs it
 * refused came back with a two-sentence description and no specs. Exa read the
 * same page for the search, and its copy of the text travels here. When the
 * server cannot read a page itself, the read step uses that copy instead,
 * labelled "text captured by search" and fenced as untrusted data like any
 * other page.
 *
 * - {@link selectSearchTexts} — which of the search's texts cross the step
 *   boundary: only those for pages the read step may try, so the workflow's
 *   event log does not carry six pages a search nobody will read.
 * - {@link findSearchText} — the copy for one URL: the same page, or the same
 *   page at a locale or trailing-slash variant (`/en/x2d` and `/en-us/x2d/`).
 * - {@link usesSearchText} — which failed reads it replaces.
 *
 * Pure. Plain Node: step code imports this.
 */

/** Below this, a captured text is a cookie banner or a title, not a page. */
export const SEARCH_TEXT_MIN_CHARS = 200;

/** At most this many captured texts cross from the search step to the read step. */
export const MAX_SEARCH_TEXTS_CARRIED = 8;

/** A locale path segment: `en`, `en-us`, `pt_BR`, `zh-hans`. */
const LOCALE_SEGMENT = /^[a-z]{2}(?:[-_][a-z0-9]{2,4})?$/;

/**
 * The page a URL names, for matching: the host without `www.`, the path
 * lower-cased without a trailing slash, and without a leading locale segment;
 * no query and no fragment. Two URLs with the same key are taken to be the same
 * page. Null for anything that is not an http(s) URL.
 */
export function pageKey(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const segments = url.pathname.toLowerCase().split("/").filter(Boolean);
  if (segments.length > 1 && LOCALE_SEGMENT.test(segments[0])) segments.shift();
  return `${host}/${segments.join("/")}`;
}

/**
 * The captured text for `url`: the result for exactly that URL first, then one
 * for the same page ({@link pageKey}). Null when there is none, or when what was
 * captured is too short to be the page ({@link SEARCH_TEXT_MIN_CHARS}).
 */
export function findSearchText(url: string, texts: readonly SearchPageText[]): SearchPageText | null {
  const usable = texts.filter((entry) => entry.text.trim().length >= SEARCH_TEXT_MIN_CHARS);
  const exact = usable.find((entry) => entry.url === url);
  if (exact) return exact;
  const key = pageKey(url);
  if (!key) return null;
  return usable.find((entry) => pageKey(entry.url) === key) ?? null;
}

/**
 * The texts worth carrying to the read step: those for one of `urls` (the
 * search's candidate links and sources — the only pages the read step may try),
 * in `urls` order, each once, at most {@link MAX_SEARCH_TEXTS_CARRIED}.
 */
export function selectSearchTexts(texts: readonly SearchPageText[], urls: readonly string[]): SearchPageText[] {
  const out: SearchPageText[] = [];
  const taken = new Set<string>();
  for (const url of urls) {
    if (out.length >= MAX_SEARCH_TEXTS_CARRIED) break;
    const found = findSearchText(url, texts);
    if (!found || taken.has(found.url)) continue;
    taken.add(found.url);
    out.push(found);
  }
  return out;
}

/** What the server's own read of a page came to, as far as the fallback cares. */
export interface ReadOutcome {
  status: "ok" | "blocked" | "failed" | "too_large" | "unsupported";
  text: string | null;
  pdf: Uint8Array | null;
}

/**
 * True when the search's copy should stand in for the server's own read: the
 * read failed (an HTTP error such as a 403 bot challenge or a 429, a timeout, a
 * network error), the page was too large, or it answered with no usable text.
 *
 * **Not** when our own guard refused it (`blocked`: a private address, a host
 * off the search's list, a bad scheme) — that refusal is a decision, and the
 * fallback does not second-guess it — nor for a PDF or an unsupported type,
 * which were read for what they are.
 */
export function usesSearchText(outcome: ReadOutcome): boolean {
  if (outcome.status === "failed" || outcome.status === "too_large") return true;
  if (outcome.status !== "ok" || outcome.pdf) return false;
  return (outcome.text?.trim() ?? "").length === 0;
}
