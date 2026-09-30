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
 */
export async function requestManualArchive(resourceIds: readonly string[]): Promise<boolean> {
  const ids = [...new Set(resourceIds.filter(isUuid))];
  if (ids.length === 0) return false;
  try {
    const { startManualArchive } = await import("./start.ts");
    return await startManualArchive(ids);
  } catch {
    console.error("[manuals] could not request a manual archive; the nightly backfill will retry");
    return false;
  }
}
