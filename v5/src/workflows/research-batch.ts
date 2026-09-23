import { RESEARCH_CONCURRENCY } from "../lib/intake/limits.ts";
import { fetchAndVerifyItem, finishBatch, markItemFailed, searchItem } from "../lib/research/steps.ts";

/**
 * `researchBatch` — background research for the items one Research press sent
 * (spec §3.7, §5.4 step 9; resized by the 2026-09-22 amendment).
 *
 * Started only by `POST /api/pending-tools/research`, as
 * `start(researchBatch, [requestId, itemIds])`. The items arrive already
 * `queued`; each ends `researched` or `failed` **independently** — one item
 * the provider refuses, or that times out three times, is marked failed with
 * its reason and the rest carry on.
 *
 * **Three at a time, in fixed chunks.** The body is a workflow function: it is
 * replayed from the run's event log after every step, and a replay must issue
 * the same step calls in the same order. So it is `chunk` + `Promise.allSettled`
 * over the chunk, which depends only on `itemIds`. `mapWithConcurrency`
 * (`capabilities/intake.ts`) must not be used here: it is a shared-cursor
 * worker pool whose order depends on which call finishes first, and a replay
 * would diverge (the amendment). Nothing here reads the clock or draws a random
 * number, for the same reason; the steps do all of that.
 *
 * Everything that touches the database, the model or the network is a step in
 * `src/lib/research/steps.ts`.
 */
export async function researchBatch(
  requestId: string,
  itemIds: string[]
): Promise<{ researched: number; failed: number }> {
  "use workflow";
  let researched = 0;
  let failed = 0;
  let skipped = 0;

  for (const group of chunk(itemIds, RESEARCH_CONCURRENCY)) {
    const settled = await Promise.allSettled(group.map((id) => researchOne(id, requestId)));
    for (let i = 0; i < group.length; i += 1) {
      const outcome = settled[i];
      if (outcome.status === "fulfilled") {
        if (outcome.value === "researched") researched += 1;
        else skipped += 1;
        continue;
      }
      failed += 1;
      try {
        await markItemFailed(group[i], requestId, failureMessage(outcome.reason));
      } catch {
        // The row could not be written even after the step's retries. Leave it
        // and research the rest: one unwritable row must not strand the batch.
      }
    }
  }

  await finishBatch(requestId, { researched, failed, skipped });
  return { researched, failed };
}

/**
 * One item, both steps. A plain function in workflow scope, not a step. Every
 * step carries `requestId`, so each writes only while the row is still this
 * run's to write.
 */
async function researchOne(id: string, requestId: string): Promise<"researched" | "skipped"> {
  const search = await searchItem(id, requestId);
  if (search.skip) return "skipped";
  const fetched = await fetchAndVerifyItem(id, requestId, search.findings);
  return fetched.outcome;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size));
  return groups;
}

/**
 * What `research_error` will say. The steps throw classified errors whose
 * message is already written for that column (`research/errors.ts`). Read by
 * shape rather than `instanceof Error`: the workflow body runs in its own VM
 * context, whose `Error` is not the host's.
 */
function failureMessage(reason: unknown): string {
  const message = typeof reason === "object" && reason !== null ? (reason as { message?: unknown }).message : reason;
  if (typeof message === "string" && message) return message;
  return "Research failed for an unknown reason.";
}
