import { FatalError, RetryableError } from "workflow";
import { isTransientDbError } from "../mirror/steps.ts";
import { getDb } from "../db/client.ts";
import { archiveManual, type ArchiveManualResult } from "./archive.ts";
import { generateDocumentQuestions, type EvalQuestionsOutcome } from "./eval-questions.ts";
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
 * 1) and search passages (phase 2) — `index-document.ts`, `passages.ts`. Runs after {@link archiveManualStep} in the same
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
  // Phase 2: a passage embedding the Gateway could not do this minute (rate
  // limit, a provider's bad minute, a timeout). The text is already stored, so
  // the retry skips extraction and embeds again; after the last retry the
  // document stays text-only until the next run or the backfill.
  if (outcomes.some((outcome) => outcome.status !== "failed" && outcome.passages?.status === "failed" && outcome.passages.transient)) {
    throw new RetryableError(`Manual index: passages could not be embedded for resource ${resourceId}.`, {
      retryAfter: RETRY_AFTER,
    });
  }
  return outcomes;
}
indexManualStep.maxRetries = MANUAL_STEP_MAX_RETRIES;

/**
 * Write eval questions for the documents whose passages this run built
 * (manual text spec amendment 2026-10-07, `eval-questions.ts`). A document
 * whose text is unchanged is skipped and the same text on another document is
 * copied, so a rebuild for a new chunker asks nothing. `MANUAL_EVAL_QUESTIONS=0`
 * makes every one `disabled`.
 *
 * **Only the model's bad minute is retried** (rate limit, 5xx, timeout, no
 * answer) and the database when it was unreachable; on the retry the documents
 * already written are `up_to_date`, so only the failed ones are asked again.
 * An unreadable answer or a refused request is returned, not retried. This
 * step can never change what the archive or the index counted.
 */
export async function evalQuestionsStep(documentIds: string[]): Promise<EvalQuestionsOutcome[]> {
  "use step";
  const outcomes: EvalQuestionsOutcome[] = [];
  try {
    const db = await getDb();
    for (const id of documentIds) outcomes.push(await generateDocumentQuestions(db, id));
  } catch (error) {
    if (isTransientDbError(error)) {
      throw new RetryableError("Manual eval questions: the database could not be reached.", { retryAfter: RETRY_AFTER });
    }
    throw new FatalError("Manual eval questions failed.");
  }
  if (outcomes.some((outcome) => outcome.status === "failed" && outcome.transient)) {
    throw new RetryableError("Manual eval questions: the model could not answer this minute.", { retryAfter: RETRY_AFTER });
  }
  return outcomes;
}
evalQuestionsStep.maxRetries = MANUAL_STEP_MAX_RETRIES;

/**
 * What one archive run came to. `indexed` counts PDFs processed into text;
 * `indexFailed` those that could not be; `passagesBuilt` / `passagesFailed`
 * the documents whose search passages were (not) built on this run;
 * `questionsWritten` / `questionsFailed` the documents whose eval questions
 * were written or copied (or could not be) after that; `skillsWritten` /
 * `skillsFailed` the tools whose skills the run's tail wrote (or could not)
 * when the lab writes skills after research (tool skills spec 2026-10-07).
 */
export interface ManualArchiveCounts {
  archived: number;
  skipped: number;
  failed: number;
  indexed: number;
  indexFailed: number;
  passagesBuilt: number;
  passagesFailed: number;
  questionsWritten: number;
  questionsFailed: number;
  skillsWritten: number;
  skillsFailed: number;
}

/** The run is done: one line of counts. */
export async function finishManualArchive(counts: ManualArchiveCounts): Promise<void> {
  "use step";
  console.info(
    `[manuals] archive run finished: archived=${counts.archived} skipped=${counts.skipped} failed=${counts.failed}` +
      ` indexed=${counts.indexed} index_failed=${counts.indexFailed}` +
      ` passages_built=${counts.passagesBuilt} passages_failed=${counts.passagesFailed}` +
      ` questions_written=${counts.questionsWritten} questions_failed=${counts.questionsFailed}` +
      ` skills_written=${counts.skillsWritten} skills_failed=${counts.skillsFailed}`
  );
}
