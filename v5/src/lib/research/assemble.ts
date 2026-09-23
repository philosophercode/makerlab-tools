import { FatalError } from "workflow";
import { scoreConfidence, toEvidence } from "../capabilities/confidence.ts";
import type { IntakeEvidence } from "../capabilities/types.ts";
import type { CategoryOption } from "../data/taxonomy.ts";
import type { EvidencePartial, FetchDraft, ModelLink, SearchFindings } from "./model-output.ts";
import { researchResultSchema, type ResearchResult } from "./result.ts";
import { reviewerNoteForPrompt } from "../intake/reviewer-note.ts";
import { classifyPage, isVideoUrl, type PageSubject } from "./source-pages.ts";
import { matchCategory } from "./taxonomy-match.ts";

/**
 * Turn the model's draft into the {@link ResearchResult} that is stored (spec
 * §4.10, §8 "Prompt injection").
 *
 * Pure: no model, no network, no database. Everything the code — not the
 * model — decides about a result is decided here, where a test can see it:
 *
 * - **`confidence` is computed**, `scoreConfidence(toEvidence(evidence))`.
 *   There is no path by which the model sets it; a draft that claims one has
 *   had the key dropped before it arrives.
 * - **The evidence is held to what happened.** The model *reports* evidence
 *   and never grades itself, but a report is still only a claim, so a claim
 *   the rest of the result contradicts is taken back — always downwards:
 *   - no page was read (`sourceUrls` empty) → nothing external was found, and
 *     the name was not confirmed against anything;
 *   - no verified manual survived link checking → `manualFound` is false;
 *   - research is shown no photos → no plate was read;
 *   - a video, or the search's copy of a page that is not the brand's product
 *     page, is never the manufacturer's page or where the specs came from.
 *   That third rule and the first are also what make "research found nothing"
 *   come out **low**, as §5.4 requires, rather than medium on the strength of
 *   a name somebody typed.
 * - **The grade is capped by what was read**: only videos, or nothing, and it
 *   cannot be high (`readCap` in `confidence.ts`).
 * - **Resources are the verified links only**; the dropped ones travel as text
 *   in `droppedLinks` so the reviewer is told rather than the link vanishing.
 * - **The category is resolved** against the existing taxonomy.
 * - **The result must parse** against the strict schema. If it does not, the
 *   step has a bug rather than a finding, and that is a {@link FatalError}.
 */

/** A material, a piece of PPE or a tag: a short label, not a sentence. */
const MAX_LABEL_LENGTH = 60;
const MAX_LABELS = 15;
const MAX_SPECS = 30;
const MAX_SOURCE_URLS = 20;

export interface AssembleInput {
  draft: FetchDraft;
  /** Links that passed `verifyResourceLinks`. */
  verified: ModelLink[];
  /** Its `dropped` notes, one per link that did not. */
  dropped: string[];
  categories: readonly CategoryOption[];
  /** The pending item's own name, for a draft that settled on none. */
  fallbackName: string;
  /** The reviewer's instruction this research ran with, recorded on the result; absent or null for none. */
  reviewerNote?: string | null;
  /** Pages among `draft.sourceUrls` whose text came from the search's copy, not the server's own read. */
  searchTextUrls?: readonly string[];
  /** The item's brand and name — what decides whether a search copy is the brand's product page. */
  subject?: PageSubject;
}

export function assembleResearchResult(input: AssembleInput): ResearchResult {
  const { draft, verified, dropped, categories, fallbackName, reviewerNote } = input;
  const sourceUrls = httpUrls(draft.sourceUrls).slice(0, MAX_SOURCE_URLS);
  const fromSearch = new Set((input.searchTextUrls ?? []).filter((url) => sourceUrls.includes(url)));
  const subject: PageSubject = input.subject ?? { brand: null, name: draft.canonicalName || fallbackName };
  const evidence = groundedEvidence(draft.evidence, { sourceUrls, verified, fromSearch, subject });

  const result: ResearchResult = {
    canonicalName: draft.canonicalName.trim() || fallbackName.trim(),
    description: draft.description.trim(),
    specs: draft.specs.slice(0, MAX_SPECS),
    materials: labels(draft.materials),
    // PPE is the lab's call, set by staff on the review page; research never proposes it (Isaac, 2026-09-23).
    ppeRequired: [],
    tags: labels(draft.tags),
    trainingRequired: draft.trainingRequired,
    useRestrictions: draft.useRestrictions?.trim() || null,
    category: matchCategory(draft.category, categories),
    resources: verified.map(({ title, url, type }) => ({ title, url, type })),
    droppedLinks: [...dropped],
    sourceUrls,
    evidence,
    confidence: scoreConfidence(evidence, { sourceUrls }),
    ...(fromSearch.size > 0 ? { searchTextSources: [...fromSearch] } : {}),
    ...(reviewerNoteForPrompt(reviewerNote) ? { reviewerNote: reviewerNoteForPrompt(reviewerNote) } : {}),
  };

  const parsed = researchResultSchema.safeParse(result);
  if (!parsed.success) {
    const where = parsed.error.issues
      .slice(0, 3)
      .map((issue) => issue.path.join(".") || "(root)")
      .join(", ");
    throw new FatalError(`Research (assembling the result): the result did not match the schema (${where}).`);
  }
  return parsed.data;
}

/**
 * The draft for an item with no page to read (§5.4 unhappy paths: "research
 * finds nothing"). No second model call — there is nothing to give it — and
 * nothing invented: no specs, no sources, and the evidence that follows from
 * that, which grades low.
 *
 * Two cases, told apart by `keepCandidateLinks`:
 *
 * - **The search found no page** (the default): no links either.
 * - **The search found pages, but none could be read** — a manufacturer site
 *   that refuses bots, a manual behind a redirect off its host. The links the
 *   search saw are kept as resources, because they are real search results,
 *   and link verification still opens each one before anybody is shown it.
 */
export function draftFromFindings(findings: SearchFindings, options: { keepCandidateLinks?: boolean } = {}): FetchDraft {
  return {
    canonicalName: findings.canonicalName,
    description: findings.description,
    specs: [],
    materials: [],
    ppeRequired: [],
    tags: [],
    trainingRequired: null,
    useRestrictions: null,
    category: findings.category,
    resources: options.keepCandidateLinks ? [...findings.candidateLinks] : [],
    sourceUrls: [],
    evidence: findings.evidence,
  };
}

/** Links with the same URL once each, first title wins, order kept. */
export function uniqueLinks(links: readonly ModelLink[]): ModelLink[] {
  const seen = new Set<string>();
  return links.filter((link) => {
    const url = link.url.trim();
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

/**
 * The hosts of `urls`, once each — the read step's host rule: the server reads
 * a page only on a host the search found (a subdomain of one included), at
 * every redirect hop, like the chat route's `read_page`.
 */
export function uniqueHosts(urls: readonly string[]): string[] {
  const hosts = new Set<string>();
  for (const url of httpUrls(urls)) hosts.add(new URL(url).hostname);
  return [...hosts];
}

function groundedEvidence(
  reported: EvidencePartial,
  facts: { sourceUrls: string[]; verified: ModelLink[]; fromSearch: ReadonlySet<string>; subject: PageSubject }
): IntakeEvidence {
  const evidence = toEvidence(reported);
  const readSomething = facts.sourceUrls.length > 0;
  // A video is never the manufacturer's page, nor where specs come from
  // (amendment "Product-page first"): the X2D draft claimed both on the
  // strength of a YouTube video alone. The search's copy of a page counts only
  // when it is the brand's own product or specs page (amendment "Search text
  // fallback"): that copy is what stands in for a product page behind a bot
  // challenge, and nothing else is let in on the strength of it.
  const readAPage = facts.sourceUrls.some(
    (url) => !isVideoUrl(url) && (!facts.fromSearch.has(url) || classifyPage(url, facts.subject) === "product")
  );
  return {
    ...evidence,
    userStatedModel: evidence.userStatedModel && readSomething,
    modelPlateRead: null,
    manufacturerPageFound: evidence.manufacturerPageFound && readAPage,
    manualFound: evidence.manualFound && facts.verified.some((link) => link.type === "Manual"),
    specsFromSource: evidence.specsFromSource && readAPage,
  };
}

/** Trimmed, one of each (ignoring case), short ones only, a sensible number of them. */
function labels(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const label = raw.replace(/\s+/g, " ").trim().replace(/\.$/, "");
    if (!label || label.length > MAX_LABEL_LENGTH) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length === MAX_LABELS) break;
  }
  return out;
}

/** The http(s) URLs among `values`, trimmed, once each. */
function httpUrls(values: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of values) {
    const value = raw.trim();
    try {
      const url = new URL(value);
      if (url.protocol === "http:" || url.protocol === "https:") out.add(value);
    } catch {
      // Not a URL — a model's formatting slip, left out.
    }
  }
  return [...out];
}
