import { generateText } from "ai";
import { countExaCalls, EXA_SEARCH_TOOL, exaImageHints, exaPageTexts, researchExaSearch } from "../ai/exa.ts";
import { describeGatewayCall, gatewayCallReport } from "../ai/gateway-usage.ts";
import { languageModelFor, providerOptionsFor } from "../ai/models.ts";
import type { StepLike } from "../ai/tool-caps.ts";
import { completeResearch, failResearch, getPendingTool, markResearching, type PendingTool } from "../data/pending-tools.ts";
import { listCategories } from "../data/taxonomy.ts";
import {
  RESEARCH_MAX_PAGE_READS,
  RESEARCH_MAX_PDFS_READ,
  RESEARCH_MAX_WEB_SEARCHES,
  RESEARCH_STEP_MAX_RETRIES,
  RESEARCH_STEP_TIMEOUT_MS,
} from "../intake/limits.ts";
import type { ResearchFocusField } from "../intake/research-focus.ts";
import type { ImageHint } from "../web/read-page.ts";
import { assembleResearchResult, draftFromFindings, uniqueHosts, uniqueLinks } from "./assemble.ts";
import { classifyResearchError, scrub } from "./errors.ts";
import { parseFetchDraft, parseSearchFindings, type FetchDraft, type ModelLink, type SearchFindings } from "./model-output.ts";
import { buildSearchPrompt, researchSystemPrompt } from "./prompt.ts";
import {
  buildReadMessages,
  candidatePageUrls,
  manualTextUrls,
  readCandidatePages,
  readSourceUrls,
  searchTextUrls,
  type ReadPagesResult,
} from "./read-pages.ts";
import { selectSearchTexts, type SearchPageText } from "./search-text.ts";
import type { ResearchResult } from "./result.ts";
import type { BatchSummary, ItemStepResult, ReadStepResult, SearchStepResult } from "./step-types.ts";
import { DEFAULT_MAX_LINKS, verifyResourceLinks } from "./verify-links.ts";

export type { BatchSummary, ImageHint, ItemStepResult, ReadStepResult, SearchStepResult } from "./step-types.ts";

/**
 * The research workflow's search and read steps (spec §3.7, resized by the
 * 2026-09-22 amendment for the Hobby plan's 300-second function ceiling;
 * gateway spec §3.2, §3.3, §3.5, §5.1).
 *
 * **Three steps per item**, so none approaches that ceiling alone. The first
 * two are here; the third is the image stage (`image-steps.ts`):
 *
 * 1. {@link searchItem} — `queued` → `researching`, then one `researchSearch`
 *    model call with Exa search through the Gateway. Four searches is the
 *    budget, and it is **advisory** — see {@link searchItem}. It settles the
 *    model, names the pages worth reading, and hands on the images Exa
 *    reported and the text Exa captured for those pages.
 * 2. {@link readAndVerifyItem} — **the server** reads up to four of those
 *    pages (`read-pages.ts`: SSRF-guarded, on the search's hosts only; a page
 *    the server cannot open — a 403 bot challenge, a timeout — is read from the
 *    search's copy of its text instead, labelled as such), then
 *    one `researchRead` call **with no tools at all**, given the page texts
 *    fenced as untrusted data and at most two manuals — as their text while
 *    `RESEARCH_ATTACH_PDFS` is off, else as PDF file parts. Then link
 *    verification, then the result assembled in code. It is **returned, not
 *    written**, with the images the pages declared.
 * 3. `findImages` (or `completeWithoutImages` when that fails) writes the
 *    result, `researching` → `researched`, with or without images.
 *
 * Each step runs inside **its own 240-second `AbortSignal`**, so a slow
 * provider fails the attempt cleanly — as a retryable error the SDK can try
 * again — instead of the platform killing the function mid-write. Each has
 * `maxRetries` set **as a property on the function**, which is how the
 * Workflow SDK reads it; `generateText`'s own retry loop is switched off so
 * the two do not multiply. Model ids come from the job registry, so a
 * `MODEL_RESEARCH_*` override moves a step to another model without a deploy.
 * Each call asks for its job's service tier (`providerOptionsFor`: `flex` for
 * research unless `MODEL_<JOB>_TIER` says otherwise), and logs what the Gateway
 * reports it cost and the tier it applied — by request id, never the item.
 *
 * **Research writes only to the row it was given, and only while that row is
 * waiting for it** (§8 "Write safety"): every write is one of
 * `pending-tools.ts`'s conditional transitions, and every one also requires
 * the row to still carry **this run's request id** — the one the route stamped
 * when it queued the row and started the run with. An item discarded while it
 * was queued, or taken over by a later press (a start that looked failed and
 * was retried), makes step 1 answer `{ skip: true }` and nothing is written:
 * two runs never both pay to research one item.
 *
 * **Finding nothing is a result, not a failure** (§5.4 unhappy paths): when the
 * search turns up no page to read, or none of its pages could be read, step 2
 * makes no model call and drafts a result with no sources and evidence that
 * grades low. It is never `failed`, and nothing is invented to fill it.
 *
 * Steps run from a pre-built bundle under plain Node (`@workflow/vitest`
 * locally, the step route in production), so nothing here or below it may
 * import `"server-only"`, and every import is relative.
 */

/**
 * Step 1: claim the item and search.
 *
 * Claiming is `markResearching` (`queued` → `researching`, for this request
 * only). A retry of this step finds the row already `researching` under its own
 * request id — its own earlier attempt moved it — and carries on; a row that is
 * neither was discarded, settled or taken over meanwhile, and the step stops
 * without writing.
 *
 * **The four-search budget is advisory, not enforced.** `exa_search` is the
 * only tool here and the Gateway executes it, so `generateText` makes exactly
 * one request: the SDK only starts another step for client tool calls, and
 * every search — however many the model runs — happens inside the Gateway
 * before that one response comes back. There is no later step for a
 * `prepareStep` to withdraw the tool from, and neither the Gateway nor Exa
 * takes a per-request limit. What bounds it is the prompt ("at most 4 times"),
 * `numResults` per search (enforced by the Gateway, Phase 0), this step's
 * deadline, and the Gateway's spend limit; an overshoot is counted afterwards
 * and logged ({@link reportSearchOvershoot}) so it shows up rather than
 * passing silently.
 */
export async function searchItem(
  id: string,
  requestId: string,
  reviewerNote: string | null = null,
  focus: ResearchFocusField[] | null = null
): Promise<SearchStepResult> {
  "use step";
  const item = await claimForResearch(id, requestId);
  if (!item) return { skip: true };

  const signal = AbortSignal.timeout(RESEARCH_STEP_TIMEOUT_MS);
  const categories = await listCategories();

  try {
    const result = await generateText({
      model: languageModelFor("researchSearch"),
      system: researchSystemPrompt("search"),
      prompt: buildSearchPrompt(item, categories, reviewerNote, focus),
      tools: { [EXA_SEARCH_TOOL]: researchExaSearch() },
      providerOptions: providerOptionsFor("researchSearch"),
      abortSignal: signal,
      maxRetries: 0,
    });
    console.info(`[research] ${requestId}: search call ${describeGatewayCall(gatewayCallReport(result.providerMetadata))}`);
    reportSearchOvershoot(requestId, result.steps);
    const findings = parseSearchFindings(result.text);
    // Only the texts of pages the read step may try cross the step boundary.
    const searchTexts = selectSearchTexts(exaPageTexts(result.steps), [
      ...findings.candidateLinks.map((link) => link.url),
      ...findings.sourceUrls,
    ]);
    return { skip: false, findings, exaImages: exaImageHints(result.steps), searchTexts };
  } catch (error) {
    throw classifyResearchError(error, "search");
  }
}
searchItem.maxRetries = RESEARCH_STEP_MAX_RETRIES;

/**
 * Log, by count and request id only, a search that ran `exa_search` more than
 * {@link RESEARCH_MAX_WEB_SEARCHES} times. Nothing can stop it mid-call (see
 * {@link searchItem}); this makes the overshoot visible in the logs, where the
 * Gateway's cost report can be read against it. Returns the count.
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
 * Step 2: read the pages step 1 found, draft the listing from them, and check
 * every link. **It writes nothing** — the image stage writes the result it
 * returns — so it only checks that the row is still this run's to research.
 *
 * The server reads at most {@link RESEARCH_MAX_PAGE_READS} pages, only on the
 * hosts of step 1's candidates and sources (and their subdomains), and the read
 * model has no tools: it cannot be steered into opening anything. The result's
 * `sourceUrls` are the pages that were actually read, whatever the model says
 * it relied on — including a page read through `searchTexts`, the search's copy,
 * when the server's own read of it failed.
 */
export async function readAndVerifyItem(
  id: string,
  requestId: string,
  findings: SearchFindings,
  reviewerNote: string | null = null,
  searchTexts: readonly SearchPageText[] = [],
  focus: ResearchFocusField[] | null = null
): Promise<ReadStepResult> {
  "use step";
  const item = await getPendingTool(id);
  if (!item || item.status !== "researching" || item.researchRequestId !== requestId) {
    return { outcome: "skipped" };
  }

  const signal = AbortSignal.timeout(RESEARCH_STEP_TIMEOUT_MS);
  const categories = await listCategories();
  // The brand's product page, when the search found one, is always among the
  // pages read (amendment "Product-page first").
  const subject = { brand: item.brand, name: findings.canonicalName.trim() || item.name };
  const urls = candidatePageUrls(findings, RESEARCH_MAX_PAGE_READS, subject);

  let draft: FetchDraft;
  let imageHints: ImageHint[] = [];
  let fromSearch: string[] = [];
  if (urls.length === 0) {
    draft = draftFromFindings(findings);
  } else {
    let read: ReadPagesResult;
    try {
      read = await readCandidatePages(urls, {
        signal,
        allowedHosts: uniqueHosts([...findings.candidateLinks.map((link) => link.url), ...findings.sourceUrls]),
        max: RESEARCH_MAX_PAGE_READS,
        maxPdfs: RESEARCH_MAX_PDFS_READ,
        searchTexts,
      });
    } catch (error) {
      throw classifyResearchError(error, "read");
    }
    imageHints = read.imageHints;
    fromSearch = searchTextUrls(read);
    if (read.failures.length > 0 || fromSearch.length > 0) {
      // Hosts and status codes only — never a path, a query or an item name.
      const viaSearch = fromSearch.length > 0 ? `; ${fromSearch.length} from the search's text` : "";
      const manuals = manualTextUrls(read).length;
      const asText = manuals > 0 ? `; ${manuals} manual(s) as text` : "";
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
          messages: buildReadMessages(item, findings, read, categories, reviewerNote, focus),
          providerOptions: providerOptionsFor("researchRead"),
          abortSignal: signal,
          maxRetries: 0,
        });
        console.info(`[research] ${requestId}: read call ${describeGatewayCall(gatewayCallReport(providerMetadata))}`);
        draft = { ...parseFetchDraft(text), sourceUrls: readSourceUrls(read) };
      } catch (error) {
        throw classifyResearchError(error, "read");
      }
    }
  }

  let links: { verified: ModelLink[]; dropped: string[] };
  try {
    links = await verifyResourceLinks(uniqueLinks(draft.resources), { signal, maxLinks: DEFAULT_MAX_LINKS });
  } catch (error) {
    throw classifyResearchError(error, "verify");
  }

  const result = assembleResearchResult({
    draft,
    verified: links.verified,
    dropped: links.dropped,
    categories,
    fallbackName: item.name,
    reviewerNote,
    searchTextUrls: fromSearch,
    subject,
  });

  return { outcome: "drafted", result, imageHints };
}
readAndVerifyItem.maxRetries = RESEARCH_STEP_MAX_RETRIES;

/**
 * The last step of a **scoped** Research again that leaves the image alone
 * (amendment "Guided redo"): write the read step's result as a merge — only
 * the focused fields replace the stored ones (`completeResearch` with `focus`,
 * `research/focus-merge.ts`). No image stage runs, so nothing is spent on
 * pictures and the stored images and their cleaned copy stay exactly as they
 * were.
 */
export async function completeFocusedItem(
  id: string,
  requestId: string,
  result: ResearchResult,
  focus: ResearchFocusField[]
): Promise<ItemStepResult> {
  "use step";
  const stored = await completeResearch(id, result, { requestId, focus });
  if (!stored) return { outcome: "skipped" };
  const item = await getPendingTool(id);
  return { outcome: "researched", confidence: item?.research?.confidence.level ?? result.confidence.level };
}
completeFocusedItem.maxRetries = RESEARCH_STEP_MAX_RETRIES;

/**
 * The workflow gave up on an item: `queued` or `researching` → `failed`, with
 * why. `research_error` is the diagnosis record (2026-09-22 amendment), so the
 * message is the classified one from `errors.ts`, scrubbed once more on the
 * way in.
 */
export async function markItemFailed(id: string, requestId: string, message: string): Promise<boolean> {
  "use step";
  return failResearch(id, scrub(message) || "Research failed.", { requestId });
}

/**
 * The batch is done. One log line with counts and the request id — no item
 * names and no people. Nothing to revalidate: the intake pages are dynamic and
 * read the rows on every request.
 */
export async function finishBatch(requestId: string, summary: BatchSummary): Promise<void> {
  "use step";
  console.info(
    `[research] batch ${requestId} finished: researched=${summary.researched} failed=${summary.failed} skipped=${summary.skipped}`
  );
}

/**
 * `markResearching`, or the row this request's own earlier attempt already
 * claimed. A row `researching` under another request id belongs to another run.
 */
async function claimForResearch(id: string, requestId: string): Promise<PendingTool | null> {
  const claimed = await markResearching(id, { requestId });
  if (claimed) return claimed;
  const current = await getPendingTool(id);
  return current?.status === "researching" && current.researchRequestId === requestId ? current : null;
}
