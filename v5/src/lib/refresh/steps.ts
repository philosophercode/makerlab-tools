import { otherToolNames } from "../data/tool-name-clash.ts";
import { claimRefresh, completeRefresh, failRefresh, loadRefreshSubject, refreshStillResearching } from "../data/tool-refreshes.ts";
import { getDb } from "../db/client.ts";
import { IMAGE_STEP_MAX_RETRIES, IMAGE_STEP_TIMEOUT_MS, RESEARCH_STEP_MAX_RETRIES, RESEARCH_STEP_TIMEOUT_MS } from "../intake/limits.ts";
import { runRead, runSearch } from "../research/engine.ts";
import { scrub } from "../research/errors.ts";
import { errorName, imageErrorText, rankAndClean } from "../research/image-stage.ts";
import { collectCandidates } from "../research/images/candidates.ts";
import type { SearchFindings } from "../research/model-output.ts";
import type { ResearchResult } from "../research/result.ts";
import type { SearchPageText } from "../research/search-text.ts";
import type { ImageHint } from "../web/read-page.ts";
import { blindInput } from "./blind-input.ts";
import { toolManualContext } from "./manual-context.ts";
import { proposeChanges } from "./propose.ts";
import type { RefreshBatchSummary, RefreshProposeResult, RefreshReadResult, RefreshSearchResult } from "./step-types.ts";

// Nothing but steps is exported from here (the 2026-09-23 amendment): a
// workflow bundle keeps every export of a step module and everything those
// reach. Helpers live in `engine.ts`, `blind-input.ts`, `propose.ts` and
// `manual-context.ts`, imported directly.

/**
 * The refresh workflow's steps (refresh research spec §3.1).
 *
 * The same engine intake research runs — product page first, Exa's captured
 * text for a site that refuses our reader, the tool's own stored manual as
 * text, reviewer notes — over a tool that already exists:
 *
 * 1. {@link searchRefresh} — claim the refresh (`queued` → `researching`, this
 *    run's request only) and search. The model is told the tool's **name and
 *    category only** (`blind-input.ts`): research is blind, so it cannot echo a
 *    hand-typed mistake back.
 * 2. {@link readRefresh} — read the pages the search found, plus the tool's own
 *    processed manual (outline and the passages for spec-like queries, within
 *    the 16k manual budget — manual text spec §3.7), and draft the record, with
 *    every quote checked against the page it names. Returned, not written.
 * 3. {@link findRefreshImages} — only when the tool has no cover photo: probe
 *    and rank candidates. **Nothing is stored** — no cleaned copy; the image an
 *    admin accepts is downloaded then.
 * 4. {@link proposeRefresh} — load the tool as it is now, diff in code
 *    (`propose.ts`), store the proposals: `researching` → `proposed`.
 *
 * Each step has its own 240-second deadline and `maxRetries`, like intake's.
 * Every write requires the row to still be this run's. Nothing here writes a
 * tool: a person accepts each change (Article 5).
 *
 * Plain Node: relative imports, no `"server-only"` below here.
 */

export async function searchRefresh(id: string, requestId: string): Promise<RefreshSearchResult> {
  "use step";
  const refresh = await claimRefresh(id, requestId);
  if (!refresh) return { skip: true };
  const tool = await loadRefreshSubject(refresh.toolId);
  if (!tool) return { skip: true };

  const signal = AbortSignal.timeout(RESEARCH_STEP_TIMEOUT_MS);
  const search = await runSearch(blindInput(tool), { requestId, reviewerNote: refresh.note, signal });
  return { skip: false, ...search };
}
searchRefresh.maxRetries = RESEARCH_STEP_MAX_RETRIES;

export async function readRefresh(
  id: string,
  requestId: string,
  findings: SearchFindings,
  searchTexts: SearchPageText[]
): Promise<RefreshReadResult> {
  "use step";
  const refresh = await refreshStillResearching(id, requestId);
  if (!refresh) return { outcome: "skipped" };
  const tool = await loadRefreshSubject(refresh.toolId);
  if (!tool) return { outcome: "skipped" };

  const signal = AbortSignal.timeout(RESEARCH_STEP_TIMEOUT_MS);
  const toolManual = await toolManualContext(await getDb(), tool.id);
  if (toolManual) console.info(`[refresh] ${requestId}: the tool's own manual given as ${toolManual.mode} (${toolManual.text.length} chars)`);
  const { result, imageHints } = await runRead(blindInput(tool), findings, {
    requestId,
    reviewerNote: refresh.note,
    signal,
    searchTexts,
    toolManual,
  });
  return { outcome: "drafted", result, imageHints, needsImage: !tool.hasCover };
}
readRefresh.maxRetries = RESEARCH_STEP_MAX_RETRIES;

/**
 * Probe and rank product images for a tool with no cover photo, and return the
 * result with `images` filled in (or `imageError`). Writes nothing and stores
 * nothing. A ranking failure is an `imageError`, never a failed refresh;
 * anything unexpected throws, and the workflow proposes without images.
 */
export async function findRefreshImages(
  id: string,
  requestId: string,
  result: ResearchResult,
  hints: ImageHint[]
): Promise<ResearchResult> {
  "use step";
  const refresh = await refreshStillResearching(id, requestId);
  if (!refresh) return result;
  try {
    const candidates = collectCandidates(
      hints.filter((hint) => hint.source !== "exa"),
      hints.filter((hint) => hint.source === "exa"),
      { name: result.canonicalName, brand: null }
    );
    const outcome = await rankAndClean(await getDb(), id, result.canonicalName, candidates, {
      signal: AbortSignal.timeout(IMAGE_STEP_TIMEOUT_MS),
      clean: false,
    });
    return { ...result, images: outcome.images, imageError: outcome.imageError };
  } catch (error) {
    throw new Error(`The image search failed unexpectedly (${errorName(error)}).`, { cause: error });
  }
}
findRefreshImages.maxRetries = IMAGE_STEP_MAX_RETRIES;

/**
 * Diff the research against the tool **as it is now** and store the proposals:
 * `researching` → `proposed`. `imageFailure` is why the image step gave up,
 * recorded on the result.
 */
export async function proposeRefresh(
  id: string,
  requestId: string,
  result: ResearchResult,
  imageFailure: string | null = null
): Promise<RefreshProposeResult> {
  "use step";
  const refresh = await refreshStillResearching(id, requestId);
  if (!refresh) return { outcome: "skipped" };
  const tool = await loadRefreshSubject(refresh.toolId);
  if (!tool) return { outcome: "skipped" };

  const research: ResearchResult = imageFailure ? { ...result, images: null, imageError: imageErrorText(imageFailure) } : result;
  // The other tools' names: a proposed display name is never one of them.
  const takenNames = await otherToolNames(await getDb(), refresh.toolId);
  const proposals = proposeChanges({ tool, research, includeDescription: refresh.includeDescription, takenNames });
  const stored = await completeRefresh(id, requestId, research, proposals);
  return stored ? { outcome: "proposed", proposals: proposals.length } : { outcome: "skipped" };
}
proposeRefresh.maxRetries = RESEARCH_STEP_MAX_RETRIES;

/** The workflow gave up on a refresh: `failed`, with the classified reason, scrubbed. */
export async function markRefreshFailed(id: string, requestId: string, message: string): Promise<boolean> {
  "use step";
  return failRefresh(id, requestId, scrub(message) || "Refresh research failed.");
}

/** One log line with counts and the request id — no tool names, no people. */
export async function finishRefreshBatch(requestId: string, summary: RefreshBatchSummary): Promise<void> {
  "use step";
  console.info(
    `[refresh] batch ${requestId} finished: proposed=${summary.proposed} failed=${summary.failed} skipped=${summary.skipped}`
  );
}
