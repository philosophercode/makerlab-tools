import { CITE_HREF_PREFIX, isCitationLikeHref, pageFromUrl, refFromHref, withoutFragment } from "./citation-ref.ts";

/**
 * "Citations resolve" (manual text spec amendment 2026-09-28): the check the
 * eval, the integration test and anybody debugging an answer run over one
 * answer and the manual passages its searches returned. **Pure** — the
 * evidence it needs (what each PDF address answered, its page count, the
 * stored page texts) is gathered by `citation-evidence.ts` and handed in.
 *
 * Every manual-looking link in the answer (`isCitationLikeHref`: a
 * `#cite-<ref>`, a PDF, a `#page=` anchor, a Blob or local-store file) must:
 *
 * 1. **come from a tool result** — a `ref` a `search_manual` call returned
 *    (with a URL), or exactly a passage's `url`;
 * 2. **resolve** — the passage's URL answers 200 with `application/pdf` and
 *    bytes that open like a PDF;
 * 3. **point at a page the PDF has** — its `#page=N` is 1…page count;
 * 4. **cite words that are on that page** — the passage's text is found on
 *    pages N…(its last page) of the stored text (`manual_pages`);
 * 5. **name the document it opens** — when the linked words carry a citation
 *    ("… (Form 4 Manual, p. 42)"), its title and page are the passage's own:
 *    the label and the URL come from the same `manual_documents` row, so an
 *    answer that calls the Bambu quick-start guide "SOP, p. 9" fails.
 *
 * The checks run on the tool's URL, never on what the model wrote: the chat
 * draws the tool's URL (`components/chat/manual-citations.ts`), so that is
 * what a student clicks.
 */

/** A passage as `search_manual` handed it to the model (`capabilities/manuals.ts`). */
export interface ToolPassage {
  ref: string;
  citation: string;
  url: string | null;
  /** The fenced passage text, as the tool returned it. */
  text: string;
}

/** What one PDF address (no fragment) answered, and what the lab stores for it. */
export interface DocumentEvidence {
  /** HTTP status of a GET; 0 when the request failed outright. */
  status: number;
  /** Media type, lower-cased, without parameters; null when absent. */
  contentType: string | null;
  /** `%PDF-` in the first kilobyte. */
  pdfMagic: boolean;
  /** Pages the PDF has (parsed from its bytes); null when it could not be read. */
  pageCount: number | null;
  /** The stored text of each page (`manual_pages`), 1-based; empty when none is stored. */
  pages: ReadonlyMap<number, string>;
}

export type CitationProblem =
  | "not_from_tool"
  | "does_not_resolve"
  | "not_a_pdf"
  | "page_out_of_range"
  | "passage_not_on_page"
  | "label_mismatch";

export interface CitationVerdict {
  /** The address as the answer wrote it. */
  href: string;
  /** The tool's URL it stands for, when it stands for one. */
  url: string | null;
  page: number | null;
  problems: CitationProblem[];
  detail: string[];
}

export interface CitationReport {
  ok: boolean;
  citations: CitationVerdict[];
}

/** One link in an answer, with its words (empty for a bare address). */
export interface AnswerLink {
  href: string;
  words: string;
}

const INLINE_LINK = /\[((?:[^[\]]|\[[^[\]]*\])*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;

/** Every link in a Markdown answer with its words: `[words](href)`, `<https://…>` and bare `https://…`. */
export function answerLinkEntries(markdown: string): AnswerLink[] {
  const links: AnswerLink[] = [];
  for (const match of markdown.matchAll(INLINE_LINK)) links.push({ href: match[2], words: match[1] });
  const withoutInline = markdown.replace(INLINE_LINK, " ");
  for (const match of withoutInline.matchAll(/<(https?:\/\/[^>\s]+)>/g)) links.push({ href: match[1], words: "" });
  for (const match of withoutInline.replace(/<https?:\/\/[^>\s]+>/g, " ").matchAll(/https?:\/\/[^\s)\]>"']+/g)) {
    links.push({ href: match[0].replace(/[.,;:!?]+$/, ""), words: "" });
  }
  return links;
}

/** Every link address in a Markdown answer. */
export function answerLinks(markdown: string): string[] {
  return answerLinkEntries(markdown).map((link) => link.href);
}

/**
 * The citation a link's words carry — "Replacing the tank (Form 4 Manual,
 * p. 42)" → `{ title: "Form 4 Manual", page: 42 }` — or null when the words
 * name no page.
 */
export function wordsCitation(words: string): { title: string; page: number } | null {
  const pages = [...words.matchAll(/,\s*pp?\.\s*(\d+)/g)];
  const last = pages[pages.length - 1];
  if (!last || last.index === undefined) return null;
  const before = words.slice(0, last.index);
  const title = before.slice(before.lastIndexOf("(") + 1).trim();
  return title ? { title, page: Number(last[1]) } : null;
}

/** "Form 4 Manual, pp. 42–43 (printed 3-12)" → "Form 4 Manual". */
export function citationTitle(citation: string): string {
  return citation.replace(/,\s*pp?\. .*$/, "").trim();
}

/** The passages of every finished `search_manual` result, from recorded outputs. */
export function toolPassages(outputs: readonly unknown[]): ToolPassage[] {
  const out: ToolPassage[] = [];
  for (const output of outputs) {
    const value = output as { status?: unknown; passages?: unknown } | null;
    if (!value || value.status !== "ok" || !Array.isArray(value.passages)) continue;
    for (const raw of value.passages as Array<Record<string, unknown>>) {
      if (typeof raw?.citation !== "string" || typeof raw?.text !== "string") continue;
      out.push({
        ref: typeof raw.ref === "string" ? raw.ref.toLowerCase() : "",
        citation: raw.citation,
        url: typeof raw.url === "string" && raw.url.trim() ? raw.url.trim() : null,
        text: raw.text,
      });
    }
  }
  return out;
}

/** The passage a link stands for: its `#cite-<ref>`, or exactly its URL. */
export function passageForHref(href: string, passages: readonly ToolPassage[]): ToolPassage | null {
  const ref = refFromHref(href);
  if (ref) return passages.find((p) => p.ref === ref && p.url) ?? null;
  const target = href.trim();
  return passages.find((p) => p.url === target) ?? null;
}

/** The citation-like links of an answer, deduplicated, in order. */
export function citationLinks(markdown: string): string[] {
  return [...new Set(answerLinks(markdown).filter(isCitationLikeHref))];
}

/** The PDF addresses (no fragment) whose evidence a check of this answer needs. */
export function evidenceUrls(markdown: string, passages: readonly ToolPassage[]): string[] {
  const urls = new Set<string>();
  for (const href of citationLinks(markdown)) {
    const passage = passageForHref(href, passages);
    if (passage?.url) urls.add(withoutFragment(passage.url));
  }
  return [...urls];
}

/** Check every citation-like link in `markdown` (see the module comment). */
export function checkCitations(
  markdown: string,
  passages: readonly ToolPassage[],
  evidence: ReadonlyMap<string, DocumentEvidence>
): CitationReport {
  const entries = answerLinkEntries(markdown);
  const citations = citationLinks(markdown).map((href) =>
    judge(
      href,
      entries.filter((entry) => entry.href === href).map((entry) => entry.words),
      passages,
      evidence
    )
  );
  return { ok: citations.every((c) => c.problems.length === 0), citations };
}

function judge(
  href: string,
  labels: readonly string[],
  passages: readonly ToolPassage[],
  evidence: ReadonlyMap<string, DocumentEvidence>
): CitationVerdict {
  const passage = passageForHref(href, passages);
  if (!passage?.url) {
    const why = href.toLowerCase().startsWith(CITE_HREF_PREFIX)
      ? `no search_manual result has the ref in ${href}`
      : `${href} is not an address any search_manual result returned`;
    return { href, url: null, page: null, problems: ["not_from_tool"], detail: [why] };
  }
  const url = passage.url;
  const page = pageFromUrl(url);
  const verdict: CitationVerdict = { href, url, page, problems: [], detail: [] };
  const title = citationTitle(passage.citation);
  for (const words of labels) {
    const said = wordsCitation(words);
    if (!said) continue;
    const within = page !== null && said.page >= page && said.page <= Math.max(page, lastPage(passage.citation) ?? page);
    if (sameTitle(said.title, title) && within) continue;
    verdict.problems.push("label_mismatch");
    verdict.detail.push(`the words say "${said.title}, p. ${said.page}" but the link opens ${passage.citation}`);
    return verdict;
  }
  const doc = evidence.get(withoutFragment(url));
  if (!doc || doc.status !== 200) {
    verdict.problems.push("does_not_resolve");
    verdict.detail.push(`${withoutFragment(url)} answered ${doc ? doc.status || "no response" : "nothing (not fetched)"}`);
    return verdict;
  }
  if (doc.contentType !== "application/pdf" || !doc.pdfMagic) {
    verdict.problems.push("not_a_pdf");
    verdict.detail.push(`${withoutFragment(url)} answered ${doc.contentType ?? "no content type"}${doc.pdfMagic ? "" : " without %PDF-"}`);
    return verdict;
  }
  if (page === null || doc.pageCount === null || page < 1 || page > doc.pageCount) {
    verdict.problems.push("page_out_of_range");
    verdict.detail.push(`page ${page ?? "(none)"} of a PDF with ${doc.pageCount ?? "an unknown number of"} pages`);
    return verdict;
  }
  const last = Math.max(page, lastPage(passage.citation) ?? page);
  const onPages = Array.from({ length: last - page + 1 }, (_, i) => doc.pages.get(page + i) ?? "").join("\n");
  if (!passageOnPages(unfence(passage.text), onPages)) {
    verdict.problems.push("passage_not_on_page");
    verdict.detail.push(`the passage cited as "${passage.citation}" is not on page${last > page ? `s ${page}–${last}` : ` ${page}`} of the stored text`);
  }
  return verdict;
}

/** "Form 4 Manual, pp. 42–43" → 43; "p. 42" → 42; nothing → null. */
export function lastPage(citation: string): number | null {
  const range = /\bpp\. (\d+)\s*[–-]\s*(\d+)/.exec(citation);
  if (range) return Number(range[2]);
  const single = /\bp\. (\d+)/.exec(citation);
  return single ? Number(single[1]) : null;
}

/** A fenced passage (`web/fence.ts`) without its markers and preamble. */
export function unfence(fenced: string): string {
  const lines = fenced.split("\n");
  if (lines.length >= 3 && /^<untrusted-page\b/.test(lines[0]) && /^<\/untrusted-page\b/.test(lines[lines.length - 1])) {
    return lines.slice(2, -1).join("\n");
  }
  return fenced.replace(/<\/?untrusted-page\b[^>]*>/g, " ");
}

/** How many of the passage's opening words must be found, in order, on the page(s). */
const PROBE_WORDS = 12;

/**
 * True when the passage's opening words (up to {@link PROBE_WORDS}) appear in
 * order in the pages' text — compared as lower-cased words, so line breaks,
 * hyphenation spacing and punctuation do not matter. A passage with no words
 * is not evidence of anything.
 */
export function passageOnPages(passage: string, pagesText: string): boolean {
  const probe = words(passage).slice(0, PROBE_WORDS);
  if (probe.length === 0) return false;
  const haystack = ` ${words(pagesText).join(" ")} `;
  return haystack.includes(` ${probe.join(" ")} `);
}

/**
 * Titles compared as words, so case and punctuation do not matter; a shortened
 * title of at least two words counts ("Form Wash Guide" for "Form Wash Guide
 * (scanned)"), a different document does not ("… SOP" for "Quick Start Guide
 * for X1-Carbon").
 */
function sameTitle(a: string, b: string): boolean {
  const x = words(a);
  const y = words(b);
  if (x.join(" ") === y.join(" ")) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 2 && ` ${long.join(" ")} `.includes(` ${short.join(" ")} `);
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}
