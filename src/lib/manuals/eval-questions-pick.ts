import { createHash } from "node:crypto";
import { looksEnglish } from "./language.ts";

/**
 * Which passages of a manual the eval questions are written from (manual text
 * spec amendment 2026-10-07), and the digest that says a manual's text is
 * the same as last time. Pure: no database, no model.
 *
 * - **How many.** `MANUAL_EVAL_QUESTIONS` (default {@link DEFAULT_EVAL_QUESTIONS},
 *   at most {@link MAX_EVAL_QUESTIONS}; `0` turns generation off). A short
 *   manual gets fewer: at most one question for every two passages worth
 *   asking about, and never fewer than one when there is any.
 * - **Which passages.** Not a table of contents, an index, a legal or
 *   warranty page, a regulatory notice or a page of dot leaders; not a stub
 *   of a few lines; not one spanning more than {@link MAX_PAGE_SPAN} pages
 *   (its page would be a guess). From those, an even spread through the
 *   document, preferring a top-level section and a page not used yet, so the
 *   questions cover the manual rather than its first chapter.
 * - **Spares.** The model may decline a passage (nothing a student would ask),
 *   so it is offered {@link SPARE_PASSAGES} more than it needs.
 *
 * Plain Node: the workflow step and the backfill both run it.
 */

export const DEFAULT_EVAL_QUESTIONS = 4;
export const MAX_EVAL_QUESTIONS = 10;
/** Passages offered beyond the count, for the ones the model declines. */
export const SPARE_PASSAGES = 2;
/** A passage shorter than this has too little to ask about. */
export const MIN_PASSAGE_CHARS = 250;
/** A passage spanning more pages than this cannot pin its answer to a page. */
export const MAX_PAGE_SPAN = 2;

/**
 * Questions per manual: `MANUAL_EVAL_QUESTIONS` when it is a whole number from
 * 0 to {@link MAX_EVAL_QUESTIONS}, else {@link DEFAULT_EVAL_QUESTIONS}. `0`
 * turns generation off (the workflow step and the backfill do nothing). A bad
 * value is ignored, with a warning.
 */
export function evalQuestionCount(): number {
  const raw = process.env.MANUAL_EVAL_QUESTIONS?.trim();
  if (!raw) return DEFAULT_EVAL_QUESTIONS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > MAX_EVAL_QUESTIONS) {
    console.warn(`[manuals] MANUAL_EVAL_QUESTIONS is not a whole number from 0 to ${MAX_EVAL_QUESTIONS}; using ${DEFAULT_EVAL_QUESTIONS}`);
    return DEFAULT_EVAL_QUESTIONS;
  }
  return n;
}

/** One stored passage, as the picker reads it. */
export interface PassageForQuestions {
  ordinal: number;
  sectionPath: string[];
  pageStart: number;
  pageEnd: number;
  content: string;
}

/**
 * The digest of a document's text: every page's number and text, in page
 * order. The same text always hashes the same, whatever its passages.
 */
export function documentTextHash(pages: readonly { pageNumber: number; text: string }[]): string {
  const hash = createHash("sha256");
  for (const page of [...pages].sort((a, b) => a.pageNumber - b.pageNumber)) {
    hash.update(`${page.pageNumber}\u0000${page.text}\u0001`);
  }
  return `sha256:${hash.digest("hex")}`;
}

/** Section titles and opening words that mark a page nobody asks a question about. */
const BOILERPLATE =
  /\b(table of contents|index|glossary|warranty|guarantee|legal|copyright|trademarks?|disclaimer|liability|declaration of conformity|conformity|regulatory|compliance|fcc|ic statement|weee|rohs|licen[cs]e|terms and conditions|revision history|document history|imprint|about this (manual|guide|document))\b/i;

/** Whether a passage is a table of contents, an index, legal text and the like. */
export function isBoilerplate(passage: PassageForQuestions): boolean {
  const section = passage.sectionPath.join(" › ");
  if (section && BOILERPLATE.test(section)) return true;
  // "Contents" alone is the contents page; "Box contents" is a fair question.
  if (passage.sectionPath.some((title) => /^\s*contents\s*$/i.test(title))) return true;
  const firstLine = passage.content.trim().split("\n")[0]?.trim() ?? "";
  if (/^contents$/i.test(firstLine) || (firstLine.length < 80 && BOILERPLATE.test(firstLine))) return true;
  return looksLikeListing(passage.content);
}

/**
 * Most lines end in a page number or run dot leaders, or are mostly digits: a
 * contents page, an index or a parts table with no sentence to ask about.
 */
function looksLikeListing(content: string): boolean {
  const lines = content.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length < 4) return false;
  const listing = lines.filter(
    (line) => /\.{4,}|…{2,}/.test(line) || /\s\d{1,4}$/.test(line) || (line.replace(/[^0-9]/g, "").length > line.length * 0.5)
  ).length;
  return listing / lines.length > 0.5;
}

/**
 * Whether a passage can carry a question: enough words, one page or two, not
 * boilerplate, and in English — a multilingual manual's other sections repeat
 * the English one on pages the chat does not cite.
 */
export function isAskable(passage: PassageForQuestions): boolean {
  return (
    passage.content.trim().length >= MIN_PASSAGE_CHARS &&
    passage.pageEnd - passage.pageStart + 1 <= MAX_PAGE_SPAN &&
    !isBoilerplate(passage) &&
    looksEnglish(passage.content)
  );
}

/** How many questions a document with these askable passages gets. */
export function questionsFor(askable: number, count: number): number {
  if (count <= 0 || askable <= 0) return 0;
  return Math.min(count, Math.max(1, Math.ceil(askable / 2)));
}

/**
 * The passages to offer the model, in document order: `target` spread evenly
 * through the askable ones plus up to {@link SPARE_PASSAGES} spares, each from
 * a top-level section and a page not used yet where there is a choice.
 */
export function pickPassages(passages: readonly PassageForQuestions[], target: number): PassageForQuestions[] {
  const askable = passages.filter(isAskable).sort((a, b) => a.ordinal - b.ordinal);
  const wanted = Math.min(askable.length, target + SPARE_PASSAGES);
  if (wanted <= 0) return [];
  const usedSections = new Set<string>();
  const usedPages = new Set<number>();
  const picked: PassageForQuestions[] = [];
  const size = askable.length / wanted;
  for (let bucket = 0; bucket < wanted; bucket += 1) {
    const from = Math.floor(bucket * size);
    const to = Math.max(from + 1, Math.floor((bucket + 1) * size));
    const candidates = askable.slice(from, to).filter((p) => !picked.includes(p));
    if (candidates.length === 0) continue;
    const fresh = (p: PassageForQuestions) =>
      (usedSections.has(topSection(p)) ? 0 : 2) + (usedPages.has(p.pageStart) ? 0 : 1);
    // Fresh section first, then fresh page, then the longer passage (more to ask about).
    const best = [...candidates].sort((a, b) => fresh(b) - fresh(a) || b.content.length - a.content.length)[0];
    picked.push(best);
    usedSections.add(topSection(best));
    usedPages.add(best.pageStart);
  }
  return picked.sort((a, b) => a.ordinal - b.ordinal);
}

/** The pages a passage spans, in order. */
export function passagePages(passage: Pick<PassageForQuestions, "pageStart" | "pageEnd">): number[] {
  const pages: number[] = [];
  for (let page = passage.pageStart; page <= passage.pageEnd; page += 1) pages.push(page);
  return pages;
}

function topSection(passage: PassageForQuestions): string {
  return (passage.sectionPath[0] ?? "").toLowerCase();
}
