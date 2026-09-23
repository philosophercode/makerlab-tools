import { listMirrorsDueForBackstop } from "../data/mirrors.ts";
import type { Db } from "../db/types.ts";
import { startMirrorPush } from "../mirror/start.ts";

/**
 * The daily cron's mirror stage (spec §3.8 trigger 3, §3.9: "pushes any mirror
 * whose data is newer than its last sync").
 *
 * The backstop for anything the change trigger and Sync now missed: a push
 * that failed, one that ran out of rounds, a change made while another push
 * held the mirror, a start that never happened. `listMirrorsDueForBackstop`
 * picks the mirrors that are active, not running, and either never synced,
 * not `ok` last time, or behind a source table that changed since — so a
 * quiet night starts nothing.
 *
 * This stage only **starts** the pushes; each runs in its own `mirrorPush`
 * workflow, well outside the cron's 60-second function. One that cannot be
 * started counts as `failed` and the rest are still started. The route treats
 * a non-zero `failed` as a failed stage, the same as a throw (the database
 * unreachable): a backstop that silently started nothing is the quiet failure
 * the cron exists to prevent. What each push then did is on its mirror row.
 */

export interface MirrorBackstopOptions {
  /** A handle to use instead of `getDb()` — tests pass an isolated one. */
  db?: Db;
}

export interface MirrorBackstopResult {
  /** Mirrors the backstop found behind. */
  due: number;
  /** Pushes started. */
  started: number;
  /** Pushes that could not be started. */
  failed: number;
}

export async function runMirrorBackstop(options: MirrorBackstopOptions = {}): Promise<MirrorBackstopResult> {
  const due = await listMirrorsDueForBackstop({ db: options.db });
  let started = 0;
  let failed = 0;

  for (const mirrorId of due) {
    try {
      const result = await startMirrorPush(mirrorId);
      if (result.ok) started += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
  }

  if (due.length > 0) {
    console.info(`[cron] mirror backstop: due=${due.length} started=${started} failed=${failed}`);
  }
  return { due: due.length, started, failed };
}
