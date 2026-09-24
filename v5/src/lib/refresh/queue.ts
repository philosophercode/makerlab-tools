import "server-only";

import { randomUUID } from "node:crypto";
import { start } from "workflow/api";
import {
  failRefreshStart,
  queueRefreshesWithinAllowance,
  setRefreshWorkflowRun,
} from "../data/tool-refreshes";
import type { Db } from "../db/types";
import { RESEARCH_DAILY_ITEM_LIMIT, RESEARCH_MAX_ITEMS_PER_REQUEST } from "../intake/limits";
import { refreshBatch } from "../../workflows/refresh-batch";

/**
 * Queue a refresh of each tool and start the run (refresh research spec §5.1
 * steps 3–4, §8).
 *
 * The caller has checked `tools.edit` and parsed the note. Here: at most
 * {@link RESEARCH_MAX_ITEMS_PER_REQUEST} tools a press; the daily allowance,
 * counted from the same ledger as intake under the same lock; tools with an
 * open refresh skipped and counted; then `start(refreshBatch)`. When `start()`
 * throws, the rows fail with why — **Refresh again** is the retry — and the
 * answer is `start_failed`.
 *
 * Nothing refreshes on its own: this runs only from an admin's press.
 */

export interface QueueRefreshCommand {
  userId: string;
  toolIds: readonly string[];
  note: string | null;
  includeDescription: boolean;
  db?: Db;
  /** For tests: the workflow starter. */
  startRun?: (requestId: string, refreshIds: string[]) => Promise<{ runId: string }>;
}

export type QueueRefreshOutcome =
  | { ok: true; queued: number; skipped: number; missing: number; requestId: string; runId: string | null }
  | { ok: false; error: "too_many_tools" | "daily_limit" | "start_failed" | "not_found"; remaining?: number };

const DAY_MS = 24 * 60 * 60_000;

export async function queueRefresh(command: QueueRefreshCommand): Promise<QueueRefreshOutcome> {
  const toolIds = [...new Set(command.toolIds)];
  if (toolIds.length > RESEARCH_MAX_ITEMS_PER_REQUEST) return { ok: false, error: "too_many_tools" };

  const requestId = randomUUID();
  const allowed = await queueRefreshesWithinAllowance(
    toolIds,
    {
      requestedBy: command.userId,
      requestId,
      limit: RESEARCH_DAILY_ITEM_LIMIT,
      since: new Date(Date.now() - DAY_MS),
      note: command.note,
      includeDescription: command.includeDescription,
    },
    { db: command.db }
  );
  if (!allowed.ok) return { ok: false, error: "daily_limit", remaining: allowed.remaining };
  const { queued, skipped, missing } = allowed;
  if (queued.length === 0) {
    if (skipped.length === 0 && missing.length > 0) return { ok: false, error: "not_found" };
    return { ok: true, queued: 0, skipped: skipped.length, missing: missing.length, requestId, runId: null };
  }

  const refreshIds = queued.map((row) => row.refreshId);
  let runId: string;
  try {
    const run = command.startRun
      ? await command.startRun(requestId, refreshIds)
      : await start(refreshBatch, [requestId, refreshIds]);
    runId = run.runId;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[refresh] start failed for request ${requestId}:`, message);
    await failRefreshStart(refreshIds, `Could not start refresh research: ${message}`, { db: command.db });
    return { ok: false, error: "start_failed" };
  }

  try {
    await setRefreshWorkflowRun(refreshIds, runId, { db: command.db });
  } catch (error) {
    // The run has started; the id is for diagnosis only.
    console.error(`[refresh] run ${runId} started but its id was not stored:`, error);
  }
  return { ok: true, queued: queued.length, skipped: skipped.length, missing: missing.length, requestId, runId };
}
