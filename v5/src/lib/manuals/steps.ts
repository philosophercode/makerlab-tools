import { FatalError, RetryableError } from "workflow";
import { isTransientDbError } from "../mirror/steps.ts";
import { archiveManual, type ArchiveManualResult } from "./archive.ts";
import { indexResourceManuals, type IndexManualOutcome } from "./index-document.ts";

/**
 * The manual archive's workflow step (see `archive.ts`, and
 * `src/workflows/archive-manuals.ts` for the workflow).
 *
 * **Retries are for the network's bad minute and the database's, nothing
 * else.** `archiveManual` answers every expected failure as a value; the ones
 * a retry could fix — no answer, a timeout, a 5xx or 429, a Blob write that
 * failed — carry `transient: true`, and only those are thrown here as a
 * {@link RetryableError}. An HTML product page, an oversize file or a 404
 * returns as a `failed` outcome and is not retried: it would give the same
 * answer every time. A throw from `archiveManual` itself is the database —
 * retried when it was unreachable, {@link FatalError} otherwise.
 *
 * `maxRetries` is set **as a property on the step function**, which is how the
 * Workflow SDK reads it. Plain Node: relative imports, no `"server-only"`.
 */

/** Attempts after the first, per resource. */
export const MANUAL_STEP_MAX_RETRIES = 2;

const RETRY_AFTER = "1m";

export async function archiveManualStep(resourceId: string): Promise<ArchiveManualResult> {
  "use step";
  let result: ArchiveManualResult;
  try {
    result = await archiveManual(resourceId);
  } catch (error) {
    if (isTransientDbError(error)) {
      throw new RetryableError("Manual archive: the database could not be reached.", { retryAfter: RETRY_AFTER });
    }
    throw new FatalError(`Manual archive failed for resource ${resourceId}.`);
  }
  if (result.status === "failed" && result.transient) {
    throw new RetryableError(`Manual archive: ${result.reason} for resource ${resourceId}.`, {
      retryAfter: RETRY_AFTER,
    });
  }
  return result;
}
archiveManualStep.maxRetries = MANUAL_STEP_MAX_RETRIES;

/**
 * Process the resource's stored PDFs into text (manual text spec §3.1, phase
 * 1) — `index-document.ts`. Runs after {@link archiveManualStep} in the same
 * workflow, whatever the archive came to short of a failure, so it also picks
 * up a PDF staff uploaded (`has_file`) or one archived on an earlier run.
 *
 * **Only the Blob read is retried**, and the database when it was
 * unreachable. `no_text`, `failed` (encrypted, corrupt, too large) and a
 * missing blob are stored or returned as values: the same file would give the
 * same answer. Anything else is a {@link FatalError}, which the workflow
 * counts and moves past — processing never fails the archive.
 */
export async function indexManualStep(resourceId: string): Promise<IndexManualOutcome[]> {
  "use step";
  let outcomes: IndexManualOutcome[];
  try {
    outcomes = await indexResourceManuals(resourceId);
  } catch (error) {
    if (isTransientDbError(error)) {
      throw new RetryableError("Manual index: the database could not be reached.", { retryAfter: RETRY_AFTER });
    }
    throw new FatalError(`Manual index failed for resource ${resourceId}.`);
  }
  if (outcomes.some((outcome) => outcome.status === "failed" && outcome.transient)) {
    throw new RetryableError(`Manual index: the stored PDF could not be read for resource ${resourceId}.`, {
      retryAfter: RETRY_AFTER,
    });
  }
  return outcomes;
}
indexManualStep.maxRetries = MANUAL_STEP_MAX_RETRIES;

/** What one archive run came to. `indexed` counts PDFs processed into text; `indexFailed` those that could not be. */
export interface ManualArchiveCounts {
  archived: number;
  skipped: number;
  failed: number;
  indexed: number;
  indexFailed: number;
}

/** The run is done: one line of counts. */
export async function finishManualArchive(counts: ManualArchiveCounts): Promise<void> {
  "use step";
  console.info(
    `[manuals] archive run finished: archived=${counts.archived} skipped=${counts.skipped} failed=${counts.failed}` +
      ` indexed=${counts.indexed} index_failed=${counts.indexFailed}`
  );
}
