import { SUGGEST_CONCURRENCY } from "../lib/import/limits.ts";
import { finishSuggestions, suggestNameStep } from "../lib/import/suggest-steps.ts";

/**
 * `suggestNames` — the optional Suggest names pass over an import's selected
 * rows (bulk intake spec §3.3): five at a time, in fixed groups (the replay
 * reason `researchBatch` gives), one step per item. An item the provider
 * refuses is counted as failed and the rest carry on; its row simply has no
 * suggestion, which the review table shows as none.
 *
 * Started only by the import page's **Suggest names** action, after the
 * allowance was charged, as `start(suggestNames, [requestId, ids])`.
 */
export async function suggestNames(requestId: string, ids: string[]): Promise<{ suggested: number; failed: number }> {
  "use workflow";
  let suggested = 0;
  let skipped = 0;
  let failed = 0;
  for (let start = 0; start < ids.length; start += SUGGEST_CONCURRENCY) {
    const group = ids.slice(start, start + SUGGEST_CONCURRENCY);
    const settled = await Promise.allSettled(group.map((id) => suggestNameStep(id)));
    for (const outcome of settled) {
      if (outcome.status === "rejected") failed += 1;
      else if (outcome.value === "suggested") suggested += 1;
      else skipped += 1;
    }
  }
  await finishSuggestions(requestId, { suggested, skipped, failed });
  return { suggested, failed };
}
