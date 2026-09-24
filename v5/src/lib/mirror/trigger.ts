import { claimCoalescedPush, releaseCoalescedPush } from "../data/mirrors.ts";
import type { Db } from "../db/types.ts";

/**
 * `requestMirrorPush()` — "something the mirror carries just changed" (spec
 * §3.8 trigger 1).
 *
 * Called after a committed write by approving a tool (`intake/approve.ts`),
 * every tool-editor write that landed (`admin/inventory/tool-write-context.ts`
 * — saves, publish, archive, Looks good, units, resources, photos),
 * publishing or unpublishing a project (`admin/projects/actions.ts`), and
 * working a maintenance ticket (`admin/maintenance/actions.ts`). Never after a
 * refused write: nothing changed. Writes nobody wires here (a student's
 * `report_issue`, category or location edits outside the editor) catch up on
 * the daily backstop.
 *
 * **It never throws, and it never makes the caller wait on Notion.** A failed
 * push never affects the app (§3.8, Goal 8): the write has already committed,
 * and a mirror that could not be told about it catches up on the next change
 * or on the daily backstop. So every failure here is caught and leaves one
 * fixed log line with nothing about the write or the person in it.
 *
 * **One query when there is nothing to do.** `claimCoalescedPush` marks every
 * active mirror that has no push already waiting and returns their ids. None —
 * no mirror at all, or a push already on its way — is the common path, and it
 * starts nothing. Only a non-empty claim loads `start.ts` (with a dynamic
 * `import()`, so `workflow/api` stays out of this module's static graph and
 * out of every action test that reaches it) and starts `mirrorPushAfterChange`,
 * which sleeps two minutes so a burst of edits becomes one push. A start that
 * fails gives the claims back, so the next change tries again rather than
 * waiting out the ten-minute stale window.
 */
export async function requestMirrorPush(options: { db?: Db } = {}): Promise<void> {
  let claimed: string[] = [];
  try {
    claimed = await claimCoalescedPush({ db: options.db });
    if (claimed.length === 0) return;

    const { startCoalescedPush } = await import("./start.ts");
    if (await startCoalescedPush()) return;
  } catch {
    console.error("[mirror] could not request a mirror push; the next change or the daily backstop will retry");
  }

  if (claimed.length === 0) return;
  try {
    await releaseCoalescedPush(claimed, { db: options.db });
  } catch {
    console.error("[mirror] could not release a coalesced push claim; it expires on its own");
  }
}
