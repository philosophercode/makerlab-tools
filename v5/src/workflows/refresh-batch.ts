import { RESEARCH_CONCURRENCY } from "../lib/intake/limits.ts";
import type { ResearchResult } from "../lib/research/result.ts";
import type { RefreshProposeResult } from "../lib/refresh/step-types.ts";
import {
  findRefreshImages,
  finishRefreshBatch,
  markRefreshFailed,
  proposeRefresh,
  readRefresh,
  searchRefresh,
} from "../lib/refresh/steps.ts";

/**
 * `refreshBatch` — background re-research of existing tools (refresh research
 * spec §3.1, §5.1).
 *
 * Started only by the `/admin/inventory` **Refresh research** action
 * (`app/admin/refresh/actions.ts`), as `start(refreshBatch, [requestId,
 * refreshIds])`. The refreshes arrive `queued`; each ends `proposed` or
 * `failed` **independently**.
 *
 * **Three at a time, in fixed chunks**, for the reason `researchBatch` gives:
 * the body is replayed from the run's event log, so it depends only on its
 * arguments and each step's recorded outcome — no clock, no randomness, no
 * worker pool whose order depends on which call finished first.
 *
 * Per refresh: search, read, the image step when the tool has no cover photo
 * (a failure there is recorded and the refresh goes on without images), then
 * the proposals. Everything that touches the database, a model or the network
 * is a step in `src/lib/refresh/steps.ts`.
 */
export async function refreshBatch(
  requestId: string,
  refreshIds: string[]
): Promise<{ proposed: number; failed: number }> {
  "use workflow";
  let proposed = 0;
  let failed = 0;
  let skipped = 0;

  for (const group of chunk(refreshIds, RESEARCH_CONCURRENCY)) {
    const settled = await Promise.allSettled(group.map((id) => refreshOne(id, requestId)));
    for (let i = 0; i < group.length; i += 1) {
      const outcome = settled[i];
      if (outcome.status === "fulfilled") {
        if (outcome.value.outcome === "proposed") proposed += 1;
        else skipped += 1;
        continue;
      }
      failed += 1;
      try {
        await markRefreshFailed(group[i], requestId, failureMessage(outcome.reason));
      } catch {
        // The row could not be written even after the step's retries; carry on with the rest.
      }
    }
  }

  await finishRefreshBatch(requestId, { proposed, failed, skipped });
  return { proposed, failed };
}

async function refreshOne(id: string, requestId: string): Promise<RefreshProposeResult> {
  const search = await searchRefresh(id, requestId);
  if (search.skip) return { outcome: "skipped" };
  const read = await readRefresh(id, requestId, search.findings, search.searchTexts);
  if (read.outcome === "skipped") return { outcome: "skipped" };

  let result: ResearchResult = read.result;
  let imageFailure: string | null = null;
  if (read.needsImage) {
    try {
      result = await findRefreshImages(id, requestId, read.result, [...read.imageHints, ...search.exaImages]);
    } catch (error) {
      imageFailure = failureMessage(error);
    }
  }
  return proposeRefresh(id, requestId, result, imageFailure);
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size));
  return groups;
}

/** The step's classified message, read by shape (the workflow's `Error` is not the host's). */
function failureMessage(reason: unknown): string {
  const message = typeof reason === "object" && reason !== null ? (reason as { message?: unknown }).message : reason;
  if (typeof message === "string" && message) return message;
  return "Refresh research failed for an unknown reason.";
}
