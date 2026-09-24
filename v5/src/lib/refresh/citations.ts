import type { CitedField, DraftCitation } from "../research/model-output.ts";
import { CITATION_QUOTE_MAX_CHARS, CITATIONS_PER_FIELD_MAX, type Citation } from "./types.ts";

/**
 * Quote verification (refresh research spec §2 "Verified quotes", §4.2, §8).
 *
 * A model can write a sentence that sounds like a page and is not on it. So a
 * quote is shown as evidence only when **code** finds it, verbatim, in the text
 * of the page it names — a page the server actually read in this run (or, in a
 * curation turn, this chat turn). "Verbatim" forgives what extraction does to
 * text and nothing else: runs of whitespace are one space, case is ignored,
 * typographic quotes, dashes and ellipses match their plain forms, and a
 * trailing full stop the page's sentence does not end on is allowed. A quote
 * from a page that was not read — or not found on the page it names — is kept,
 * marked `verified: false`, and shown greyed: never evidence.
 *
 * Pure. Plain Node: step code imports it.
 */

/** A page's text, as it was read: what a quote is checked against. */
export interface ReadText {
  url: string;
  text: string;
}

/** Whitespace, case and typography flattened, so extraction noise does not fail a real quote. */
export function normalizeForQuote(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** The same page, however it was spelled: scheme, `www.`, a trailing slash and the fragment ignored. */
export function pageKey(raw: string): string | null {
  try {
    // A fence label may ride along: "https://…/manual.pdf (manual text)".
    const url = new URL(raw.trim().replace(/\s+\([^)]*\)$/, ""));
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.replace(/\/+$/, "");
    return `${host}${path}${url.search}`;
  } catch {
    return null;
  }
}

/** True when `quote` appears in `text` (both normalized). A quote under 8 characters proves nothing. */
export function quoteAppearsIn(quote: string, text: string): boolean {
  const needle = normalizeForQuote(quote).replace(/[.\s]+$/, "");
  if (needle.length < 8) return false;
  return normalizeForQuote(text).includes(needle);
}

/**
 * Check one field's quotes against the pages read. Each quote is looked for on
 * the page it names — and only there — so a real quote attributed to the wrong
 * page is not verified either.
 */
export function verifyQuotes(quotes: readonly DraftCitation[], pages: readonly ReadText[]): Citation[] {
  const byKey = new Map<string, string[]>();
  for (const page of pages) {
    const key = pageKey(page.url);
    if (!key) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), page.text]);
  }
  return quotes.slice(0, CITATIONS_PER_FIELD_MAX).map((citation) => {
    const quote = citation.quote.replace(/\s+/g, " ").trim().slice(0, CITATION_QUOTE_MAX_CHARS);
    const key = pageKey(citation.url);
    const texts = key ? (byKey.get(key) ?? []) : [];
    return { quote, url: citation.url.trim(), verified: texts.some((text) => quoteAppearsIn(quote, text)) };
  });
}

/** Every field's quotes, checked. Fields with none are left out. */
export function verifyCitations(
  draft: Partial<Record<CitedField, DraftCitation[]>>,
  pages: readonly ReadText[]
): Partial<Record<CitedField, Citation[]>> {
  const out: Partial<Record<CitedField, Citation[]>> = {};
  for (const [field, quotes] of Object.entries(draft) as [CitedField, DraftCitation[] | undefined][]) {
    if (!quotes || quotes.length === 0) continue;
    out[field] = verifyQuotes(quotes, pages);
  }
  return out;
}
