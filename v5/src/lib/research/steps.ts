import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import type { IntakeConfidenceLevel } from "../capabilities/types.ts";
import {
  completeResearch,
  failResearch,
  getPendingTool,
  markResearching,
  type PendingTool,
} from "../data/pending-tools.ts";
import { listCategories } from "../data/taxonomy.ts";
import {
  RESEARCH_MAX_WEB_FETCHES,
  RESEARCH_MAX_WEB_SEARCHES,
  RESEARCH_STEP_MAX_RETRIES,
  RESEARCH_STEP_TIMEOUT_MS,
} from "../intake/limits.ts";
import { resolveChatModel } from "../model.ts";
import { assembleResearchResult, draftFromFindings, uniqueHosts, uniqueLinks } from "./assemble.ts";
import { classifyResearchError, scrub } from "./errors.ts";
import {
  parseFetchDraft,
  parseSearchFindings,
  type FetchDraft,
  type ModelLink,
  type SearchFindings,
} from "./model-output.ts";
import { buildFetchPrompt, buildSearchPrompt, researchSystemPrompt } from "./prompt.ts";
import { DEFAULT_MAX_LINKS, verifyResourceLinks } from "./verify-links.ts";

/**
 * The research workflow's steps (spec §3.7, resized by the 2026-09-22
 * amendment for the Hobby plan's 300-second function ceiling).
 *
 * **Two steps per item**, so neither approaches that ceiling alone:
 *
 * 1. {@link searchItem} — `queued` → `researching`, then one model call with
 *    `web_search` (at most four uses) that settles the model and names the
 *    pages worth reading.
 * 2. {@link fetchAndVerifyItem} — one model call with `web_fetch` (at most four
 *    uses, allowed only onto the hosts step 1 found), then link verification,
 *    then the result assembled in code and written: `researching` →
 *    `researched`.
 *
 * Each step runs inside **its own 240-second `AbortSignal`**, so a slow
 * provider fails the attempt cleanly — as a retryable error the SDK can try
 * again — instead of the platform killing the function mid-write. Each has
 * `maxRetries` set **as a property on the function**, which is how the
 * Workflow SDK reads it; `generateText`'s own retry loop is switched off so
 * the two do not multiply.
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
 * search turns up no page to open, step 2 makes no model call and stores a
 * result with no links and evidence that grades low. It is never `failed`, and
 * nothing is invented to fill it.
 *
 * Steps run from a pre-built bundle under plain Node (`@workflow/vitest`
 * locally, the step route in production), so nothing here or below it may
 * import `"server-only"`, and every import is relative.
 */

export type SearchStepResult = { skip: true } | { skip: false; findings: SearchFindings };

export type FetchStepResult =
  | { outcome: "researched"; confidence: IntakeConfidenceLevel }
  | { outcome: "skipped" };

/** What the batch reports once every item has settled. No names, no people. */
export interface BatchSummary {
  researched: number;
  failed: number;
  skipped: number;
}

/**
 * Step 1: claim the item and search.
 *
 * Claiming is `markResearching` (`queued` → `researching`, for this request
 * only). A retry of this step finds the row already `researching` under its own
 * request id — its own earlier attempt moved it — and carries on; a row that is
 * neither was discarded, settled or taken over meanwhile, and the step stops
 * without writing.
 */
export async function searchItem(id: string, requestId: string): Promise<SearchStepResult> {
  "use step";
  const item = await claimForResearch(id, requestId);
  if (!item) return { skip: true };

  const signal = AbortSignal.timeout(RESEARCH_STEP_TIMEOUT_MS);
  const categories = await listCategories();

  try {
    const { text } = await generateText({
      model: resolveChatModel(),
      system: researchSystemPrompt("search"),
      prompt: buildSearchPrompt(item, categories),
      tools: {
        web_search: anthropic.tools.webSearch_20250305({ maxUses: RESEARCH_MAX_WEB_SEARCHES }),
      },
      abortSignal: signal,
      maxRetries: 0,
    });
    return { skip: false, findings: parseSearchFindings(text) };
  } catch (error) {
    throw classifyResearchError(error, "search");
  }
}
searchItem.maxRetries = RESEARCH_STEP_MAX_RETRIES;

/**
 * Step 2: read the pages step 1 found, check every link, and store the result.
 *
 * `web_fetch` is allowed onto the hosts of step 1's candidates and sources and
 * nowhere else — the chat route's allow-list pattern — and the pages are also
 * listed in the prompt, because the tool opens only URLs that appear in the
 * conversation.
 */
export async function fetchAndVerifyItem(
  id: string,
  requestId: string,
  findings: SearchFindings
): Promise<FetchStepResult> {
  "use step";
  const item = await getPendingTool(id);
  if (!item || item.status !== "researching" || item.researchRequestId !== requestId) {
    return { outcome: "skipped" };
  }

  const signal = AbortSignal.timeout(RESEARCH_STEP_TIMEOUT_MS);
  const categories = await listCategories();
  const hosts = uniqueHosts([...findings.candidateLinks.map((link) => link.url), ...findings.sourceUrls]);

  let draft: FetchDraft;
  if (hosts.length === 0) {
    draft = draftFromFindings(findings);
  } else {
    try {
      const { text } = await generateText({
        model: resolveChatModel(),
        system: researchSystemPrompt("fetch"),
        prompt: buildFetchPrompt(item, findings, categories),
        tools: {
          web_fetch: anthropic.tools.webFetch_20250910({
            maxUses: RESEARCH_MAX_WEB_FETCHES,
            maxContentTokens: 20000,
            allowedDomains: hosts,
          }),
        },
        abortSignal: signal,
        maxRetries: 0,
      });
      draft = parseFetchDraft(text);
    } catch (error) {
      throw classifyResearchError(error, "fetch");
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
  });

  const stored = await completeResearch(id, result, { requestId });
  return stored ? { outcome: "researched", confidence: result.confidence.level } : { outcome: "skipped" };
}
fetchAndVerifyItem.maxRetries = RESEARCH_STEP_MAX_RETRIES;

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
