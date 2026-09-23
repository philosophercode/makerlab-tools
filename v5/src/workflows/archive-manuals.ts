import { archiveManualStep, finishManualArchive } from "../lib/manuals/steps.ts";

/**
 * `archiveManuals` — copy each resource's manual PDF into Blob
 * (`src/lib/manuals/archive.ts`), one step per resource.
 *
 * Started, through `src/lib/manuals/start.ts`, after approving a tool (the
 * resources it created), after `create_tool` over MCP, after the tool editor
 * adds a resource or changes its link, and by the daily cron's backfill.
 *
 * **Sequential, in the order given.** The body is replayed from the run's
 * event log after every step, and a replay must issue the same step calls in
 * the same order; a handful of PDFs does not need a pool. Each resource ends
 * independently: a step that is still failing after its retries counts as
 * failed and the rest are archived.
 */
export async function archiveManuals(
  resourceIds: string[]
): Promise<{ archived: number; skipped: number; failed: number }> {
  "use workflow";
  const counts = { archived: 0, skipped: 0, failed: 0 };
  for (const id of resourceIds) {
    try {
      const result = await archiveManualStep(id);
      counts[result.status] += 1;
    } catch {
      counts.failed += 1;
    }
  }
  await finishManualArchive(counts);
  return counts;
}
