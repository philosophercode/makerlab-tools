import type { SearchPageText } from "../ai/exa.ts";
import {
  describeJudgement,
  pageLanguage,
  titleLanguage,
  urlLanguage,
  type LanguageJudgement,
} from "./language.ts";
import type { PageLanguageRecord } from "./read-pages.ts";
import { describeDropped } from "./verify-links.ts";

/**
 * The link gate (gateway spec amendment 2026-09-26 "English resources only"):
 * every link research keeps — a manual, the product page, a video, anything
 * else — is an English page or an English manual. A multilingual manual with
 * English counts as English.
 *
 * Run in `engine.ts` **before** link verification, so a dropped link neither
 * costs a request nor takes one of the eight places. Nothing is fetched here:
 * the evidence is what research already has, strongest first —
 *
 * 1. the verdict on the page the read step read for this link (its text and
 *    `lang`, `read-pages.ts`);
 * 2. the search's captured text of exactly this URL;
 * 3. the URL's own locale (`/de-de/`, `?lang=fr`, `manual_DE.pdf`);
 * 4. the link's title ("Bedienungsanleitung", a title in Japanese).
 *
 * A link with no evidence is kept: the rule drops only on evidence. A dropped
 * link is a `droppedLinks` note like any other, so the reviewer is told.
 *
 * Pure. Plain Node: step code imports it.
 */

export interface LinkLanguageEvidence {
  /** The read step's verdicts, by the URL read and the URL asked for. */
  languages?: readonly PageLanguageRecord[];
  /** The search's captured page texts. */
  searchTexts?: readonly SearchPageText[];
}

/** A URL compared loosely: no fragment, no trailing slash, host lower-cased. */
function sameUrlKey(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    url.hash = "";
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.protocol}//${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ""}${path}${url.search}`;
  } catch {
    return null;
  }
}

function isPdf(raw: string): boolean {
  try {
    return new URL(raw).pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}

/** What research knows about one link's language. */
export function linkLanguage(link: { title: string; url: string; type: string }, evidence: LinkLanguageEvidence = {}): LanguageJudgement {
  const key = sameUrlKey(link.url);
  if (key) {
    const read = (evidence.languages ?? []).find(
      (record) => sameUrlKey(record.url) === key || sameUrlKey(record.requested) === key
    );
    if (read && read.judgement.verdict !== "unknown") return read.judgement;

    const copy = (evidence.searchTexts ?? []).find((text) => sameUrlKey(text.url) === key);
    if (copy) {
      const byText = pageLanguage({ text: copy.text, manual: link.type === "Manual" || isPdf(link.url) });
      if (byText.verdict !== "unknown") return byText;
    }
  }
  const byUrl = urlLanguage(link.url);
  if (byUrl.verdict !== "unknown") return byUrl;
  return titleLanguage(link.title);
}

/** The links that are English (or unknown), in order; a note for each one that is not. */
export function keepEnglishLinks<T extends { title: string; url: string; type: string }>(
  links: readonly T[],
  evidence: LinkLanguageEvidence = {}
): { kept: T[]; dropped: string[] } {
  const kept: T[] = [];
  const dropped: string[] = [];
  for (const link of links) {
    const judgement = linkLanguage(link, evidence);
    if (judgement.verdict === "not_english") dropped.push(describeDropped(link, `not English (${describeJudgement(judgement)})`));
    else kept.push(link);
  }
  return { kept, dropped };
}
