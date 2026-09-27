import { generateText } from "ai";
import { EXA_SEARCH_TOOL, exaImageHints, exaPageTexts, researchExaSearch } from "../ai/exa.ts";
import { describeGatewayCall, gatewayCallReport } from "../ai/gateway-usage.ts";
import { languageModelFor, providerOptionsFor } from "../ai/models.ts";
import { countExaCalls } from "../ai/exa.ts";
import type { StepLike } from "../ai/tool-caps.ts";
import { findStoredManualByUrl } from "../data/manual-documents.ts";
import { listCategories } from "../data/taxonomy.ts";
import { getDb } from "../db/client.ts";
import { RESEARCH_MAX_PAGE_READS, RESEARCH_MAX_PDFS_READ, RESEARCH_MAX_WEB_SEARCHES } from "../intake/limits.ts";
import type { ResearchFocusField } from "../intake/research-focus.ts";
import { verifyCitations } from "../refresh/citations.ts";
import type { ImageHint } from "../web/read-page.ts";
import { assembleResearchResult, draftFromFindings, uniqueHosts, uniqueLinks } from "./assemble.ts";
import { keepEnglishLinks } from "./english-links.ts";
import { classifyResearchError } from "./errors.ts";
import { pickManualPdfs, withManualPdf } from "./manual-pdfs.ts";
import { parseFetchDraft, parseSearchFindings, type FetchDraft, type ModelLink, type SearchFindings } from "./model-output.ts";
import { buildSearchPrompt, researchSystemPrompt, type ResearchItemInput } from "./prompt.ts";
import {
  buildReadMessages,
  candidatePageUrls,
  manualTextUrls,
  readCandidatePages,
  readSourceUrls,
  searchTextUrls,
  type ReadPagesResult,
} from "./read-pages.ts";
import type { ResearchResult } from "./result.ts";
import { selectSearchTexts, type SearchPageText } from "./search-text.ts";
import { DEFAULT_MAX_LINKS, verifyResourceLinks } from "./verify-links.ts";

/**
 * The research engine's two model passes, apart from any row (refresh research
 * spec §3.1: "Refresh reuses them without change").
 *
 * `searchItem` and `readAndVerifyItem` (`steps.ts`) research a pending item;
 * the refresh workflow's steps (`refresh/steps.ts`) research an existing tool.
 * Both claim and check their own rows, then call {@link runSearch} and
 * {@link runRead} here with nothing but a {@link ResearchItemInput} — which is
 * what keeps refresh research **blind**: the input has no field for a
 * description, a spec, a restriction or anything else a record holds.
 *
 * Not a step module: it exports helpers, and a workflow bundle keeps every
 * export of a step module (the 2026-09-23 amendment). Only step bodies import
 * it. Plain Node: relative imports only.
 */

export interface SearchRun {
  findings: SearchFindings;
  exaImages: ImageHint[];
  searchTexts: SearchPageText[];
}

export interface RunOptions {
  /** For log lines only — never an item name. */
  requestId: string;
  reviewerNote?: string | null;
  focus?: ResearchFocusField[] | null;
  signal: AbortSignal;
}

/**
 * The search pass: one `researchSearch` call with Exa through the Gateway —
 * what the item is, which pages to read, and the images and page texts Exa
 * captured. Throws a classified error (`errors.ts`) on failure.
 */
export async function runSearch(item: ResearchItemInput, opts: RunOptions): Promise<SearchRun> {
  const categories = await listCategories();
  try {
    const result = await generateText({
      model: languageModelFor("researchSearch"),
      system: researchSystemPrompt("search"),
      prompt: buildSearchPrompt(item, categories, opts.reviewerNote ?? null, opts.focus ?? null),
      tools: { [EXA_SEARCH_TOOL]: researchExaSearch() },
      providerOptions: providerOptionsFor("researchSearch"),
      abortSignal: opts.signal,
      maxRetries: 0,
    });
    console.info(`[research] ${opts.requestId}: search call ${describeGatewayCall(gatewayCallReport(result.providerMetadata))}`);
    reportSearchOvershoot(opts.requestId, result.steps);
    const findings = parseSearchFindings(result.text);
    const allTexts = exaPageTexts(result.steps);
    // A manual PDF the search saw but did not list (manual text spec §3.7):
    // its captured text crosses with the rest, and the read step picks it up.
    const manualPdfs = pickManualPdfs(allTexts, { brand: item.brand, name: findings.canonicalName.trim() || item.name });
    // Only the texts of pages the read step may try cross the step boundary.
    const searchTexts = selectSearchTexts(allTexts, [
      ...findings.candidateLinks.map((link) => link.url),
      ...manualPdfs,
      ...findings.sourceUrls,
    ]);
    return { findings, exaImages: exaImageHints(result.steps), searchTexts };
  } catch (error) {
    throw classifyResearchError(error, "search");
  }
}

/**
 * Log, by count and request id only, a search that ran `exa_search` more than
 * {@link RESEARCH_MAX_WEB_SEARCHES} times (see `steps.ts`, `searchItem`).
 * Returns the count.
 */
export function reportSearchOvershoot(requestId: string, steps: readonly StepLike[]): number {
  const searches = countExaCalls(steps);
  if (searches > RESEARCH_MAX_WEB_SEARCHES) {
    console.warn(
      `[research] ${requestId}: the search ran ${EXA_SEARCH_TOOL} ${searches} times, over its budget of ${RESEARCH_MAX_WEB_SEARCHES} (advisory; see steps.ts)`
    );
  }
  return searches;
}

/**
 * A manual the lab already holds for the tool being refreshed (manual text
 * spec §3.7): given to the read model as one more page, `manual text` from our
 * own extraction. `urls` are every address the document goes by (its stored
 * copy, its source link), so a search result for the same file is not read a
 * second time.
 */
export interface ToolManualPage {
  url: string;
  title: string | null;
  text: string;
  urls: string[];
}

export interface ReadRun {
  result: ResearchResult;
  imageHints: ImageHint[];
}

/**
 * The read pass: the server reads the pages the search found (`read-pages.ts`),
 * the tool-less `researchRead` model drafts the record from them, the draft's
 * quotes are checked against the text of the pages they name
 * (`refresh/citations.ts`), the links are verified and the result assembled in
 * code. Returned, never written.
 */
export async function runRead(
  item: ResearchItemInput,
  findings: SearchFindings,
  opts: RunOptions & { searchTexts?: readonly SearchPageText[]; toolManual?: ToolManualPage | null }
): Promise<ReadRun> {
  const { signal } = opts;
  const searchTexts = opts.searchTexts ?? [];
  const categories = await listCategories();
  // The brand's product page, when the search found one, is always among the
  // pages read (amendment "Product-page first").
  const subject = { brand: item.brand, name: findings.canonicalName.trim() || item.name };
  // A manual PDF among the search's results, when none of the pages chosen is
  // one: it takes a place in the four reads (manual text spec §3.7).
  const manualPdfs = pickManualPdfs(searchTexts, subject);
  const toolManual = opts.toolManual ?? null;
  const ownManual = new Set(toolManual?.urls ?? []);
  const urls = withManualPdf(candidatePageUrls(findings, RESEARCH_MAX_PAGE_READS, subject), manualPdfs, RESEARCH_MAX_PAGE_READS).filter(
    (url) => !ownManual.has(url)
  );

  let draft: FetchDraft;
  let imageHints: ImageHint[] = [];
  let fromSearch: string[] = [];
  let pagesRead: ReadPagesResult["pages"] = [];
  let pageLanguages: NonNullable<ReadPagesResult["languages"]> = [];
  if (urls.length === 0 && !toolManual) {
    draft = draftFromFindings(findings);
  } else {
    let read: ReadPagesResult;
    try {
      read =
        urls.length === 0
          ? { pages: [], pdfs: [], imageHints: [], failures: [] }
          : await readCandidatePages(urls, {
              signal,
              allowedHosts: uniqueHosts([
                ...findings.candidateLinks.map((link) => link.url),
                ...findings.sourceUrls,
                ...urls.filter((url) => manualPdfs.includes(url)),
              ]),
              max: RESEARCH_MAX_PAGE_READS,
              // The tool's own manual takes one of the manual places.
              maxPdfs: toolManual ? Math.max(0, RESEARCH_MAX_PDFS_READ - 1) : RESEARCH_MAX_PDFS_READ,
              searchTexts,
              storedManual: storedManualText,
            });
    } catch (error) {
      throw classifyResearchError(error, "read");
    }
    if (toolManual) {
      read = {
        ...read,
        pages: [{ url: toolManual.url, title: toolManual.title, text: toolManual.text, via: "manual", manualSource: "stored" }, ...read.pages],
      };
    }
    imageHints = read.imageHints;
    fromSearch = searchTextUrls(read);
    pagesRead = read.pages;
    pageLanguages = read.languages ?? [];
    if (read.failures.length > 0 || fromSearch.length > 0 || manualTextUrls(read).length > 0) {
      // Hosts and status codes only — never a path, a query or an item name.
      const viaSearch = fromSearch.length > 0 ? `; ${fromSearch.length} from the search's text` : "";
      const manuals = read.pages.filter((page) => page.via === "manual");
      const asText =
        manuals.length > 0
          ? `; ${manuals.length} manual(s) as text (${manuals.map((page) => page.manualSource ?? "search").join(", ")})`
          : "";
      console.info(
        `[research] read ${urls.length - read.failures.length}/${urls.length} pages${viaSearch}${asText}; not read: ${read.failures.join("; ") || "none"}`
      );
    }

    if (read.pages.length === 0 && read.pdfs.length === 0) {
      draft = draftFromFindings(findings, { keepCandidateLinks: true });
    } else {
      try {
        const { text, providerMetadata } = await generateText({
          model: languageModelFor("researchRead"),
          system: researchSystemPrompt("read"),
          messages: buildReadMessages(item, findings, read, categories, opts.reviewerNote ?? null, opts.focus ?? null),
          providerOptions: providerOptionsFor("researchRead"),
          abortSignal: signal,
          maxRetries: 0,
        });
        console.info(`[research] ${opts.requestId}: read call ${describeGatewayCall(gatewayCallReport(providerMetadata))}`);
        draft = { ...parseFetchDraft(text), sourceUrls: readSourceUrls(read) };
      } catch (error) {
        throw classifyResearchError(error, "read");
      }
    }
  }

  // English only (amendment "English resources only"), before any link is opened:
  // a dropped link costs no request and takes none of the eight places.
  const english = keepEnglishLinks(uniqueLinks(draft.resources), { languages: pageLanguages, searchTexts });
  let links: { verified: ModelLink[]; dropped: string[] };
  try {
    const checked = await verifyResourceLinks(english.kept, { signal, maxLinks: DEFAULT_MAX_LINKS, englishOnly: true });
    links = { verified: checked.verified, dropped: [...english.dropped, ...checked.dropped] };
  } catch (error) {
    throw classifyResearchError(error, "verify");
  }

  // Quotes are checked against exactly the text the model was given — title included.
  const citations = verifyCitations(
    draft.citations ?? {},
    pagesRead.map((page) => ({ url: page.url, text: page.title ? `${page.title}\n${page.text}` : page.text }))
  );

  const result = assembleResearchResult({
    draft,
    verified: links.verified,
    dropped: links.dropped,
    categories,
    fallbackName: item.name,
    reviewerNote: opts.reviewerNote ?? null,
    searchTextUrls: fromSearch,
    subject,
    citations,
  });

  return { result, imageHints };
}

/**
 * The lab's own processed text of the manual at `url`, if a tool already holds
 * it (manual text spec §3.7) — so research reads our extraction instead of
 * downloading the PDF again. A database error is "none": the download is the
 * fallback, and a lookup must never fail the read.
 */
async function storedManualText(url: string) {
  try {
    return await findStoredManualByUrl(await getDb(), url);
  } catch {
    return null;
  }
}
