import { isUuid } from "../data/uuid.ts";

/**
 * `requestManualArchive(resourceIds)` — "these resources may have a manual
 * worth keeping a copy of".
 *
 * Called after a committed write: approving a tool (`intake/approve.ts`),
 * `create_tool` over MCP (`capabilities/intake.ts`), and the tool editor's
 * add-resource and edit-resource actions. The daily cron's backfill catches
 * anything these miss.
 *
 * **It never throws, and it never fails the write that called it** (Article
 * 4): the resource exists either way, and a copy that could not be started is
 * tomorrow night's backfill. Every failure leaves one log line and `false`.
 * Nothing is loaded for an empty list; otherwise `start.ts` comes in by a
 * dynamic `import()` so `workflow/api` stays out of the callers' static graph.
 *
 * `afterResearch` (tool skills spec 2026-10-07 §5.4): the tools an intake
 * approval just created, whose skills the run writes at its end, after their
 * manuals are indexed. Passed only when the lab writes skills after research.
 */
export async function requestManualArchive(
  resourceIds: readonly string[],
  options: { afterResearch?: readonly string[] } = {}
): Promise<boolean> {
  const ids = [...new Set(resourceIds.filter(isUuid))];
  if (ids.length === 0) return false;
  const afterResearch = [...new Set((options.afterResearch ?? []).filter(isUuid))];
  try {
    const { startManualArchive } = await import("./start.ts");
    return afterResearch.length > 0 ? await startManualArchive(ids, afterResearch) : await startManualArchive(ids);
  } catch {
    console.error("[manuals] could not request a manual archive; the nightly backfill will retry");
    return false;
  }
}
