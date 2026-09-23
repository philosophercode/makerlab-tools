import { listManualsDueForArchive } from "../data/manual-archives.ts";
import type { Db } from "../db/types.ts";
import { requestManualArchive } from "../manuals/trigger.ts";

/**
 * The daily cron's manual stage — the backfill and backstop for the manual
 * archive (`src/lib/manuals/archive.ts`).
 *
 * Every night up to {@link MANUALS_PER_NIGHT} Manual resources with a link
 * and no PDF copy of it are handed to one `archiveManuals` run: imported
 * manuals nobody has archived yet, a resource whose link was edited, an
 * approval whose run never started. The window moves each night (see
 * `listManualsDueForArchive`), so a manual whose link is an HTML page cannot
 * hold the backfill up.
 *
 * This stage only **starts** the run; the downloads happen in the workflow,
 * outside the cron's 60 seconds. A run that could not be started counts as
 * `failed`, which the route reports as a failed stage — a backfill that
 * silently started nothing is the quiet failure the cron exists to prevent.
 */

/** Manuals handed to the archive per night. */
export const MANUALS_PER_NIGHT = 10;

export interface ManualArchiveStageOptions {
  /** A handle to use instead of `getDb()` — tests pass an isolated one. */
  db?: Db;
  /** The clock, for the moving window. */
  now?: Date;
}

export interface ManualArchiveStageResult {
  /** Manual resources still without a copy of their link. */
  due: number;
  /** Handed to tonight's run. */
  queued: number;
  /** 1 when the run could not be started, else 0. */
  failed: number;
}

export async function runManualArchiveBackfill(
  options: ManualArchiveStageOptions = {}
): Promise<ManualArchiveStageResult> {
  const day = Math.floor((options.now ?? new Date()).getTime() / 86_400_000);
  const { due, ids } = await listManualsDueForArchive({ db: options.db, limit: MANUALS_PER_NIGHT, day });
  if (ids.length === 0) return { due, queued: 0, failed: 0 };

  const started = await requestManualArchive(ids);
  console.info(`[cron] manual archive: due=${due} queued=${started ? ids.length : 0} started=${started}`);
  return { due, queued: started ? ids.length : 0, failed: started ? 0 : 1 };
}
