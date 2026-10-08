import { FatalError, RetryableError } from "workflow";
import { getDb } from "../db/client.ts";
import type { ToolSkillTrigger } from "../db/schema/vocabulary.ts";
import { isTransientDbError } from "../mirror/steps.ts";
import { SKILL_STEP_MAX_RETRIES } from "./limits.ts";
import { skillsAfterResearch } from "./setting.ts";
import { toolIdsForDocuments } from "./targets.ts";
import { recordStepFailure, writeToolSkill, type ToolSkillOutcome } from "./write.ts";

/**
 * The tool skill workflow steps (tool skills spec 2026-10-07 §5.3, §5.4), run
 * by `src/workflows/tool-skills.ts` and by the archive workflow's tail.
 *
 * **Retries are for the model's bad minute and the database's, nothing
 * else.** `writeToolSkill` answers every expected failure as a value; only a
 * transient model failure (rate limit, a provider's bad minute, a timeout) is
 * thrown here as a {@link RetryableError}, a minute apart. An unreadable
 * answer is stored as a failed row and returned: the same inputs would most
 * likely read the same. A throw from the writer is the database — retried
 * when it was unreachable, {@link FatalError} otherwise.
 *
 * `maxRetries` is a property on the step function, as the Workflow SDK reads
 * it. Plain Node: relative imports, no `"server-only"`.
 */

const RETRY_AFTER = "1m";

/**
 * The tools the pass after research should write for, or none when the lab
 * setting is off: the tools just approved (`afterResearch`), then the tools of
 * the documents this archive run built passages for, each once.
 */
export async function toolSkillTargetsStep(afterResearch: string[], builtDocumentIds: string[]): Promise<string[]> {
  "use step";
  try {
    const db = await getDb();
    if (!(await skillsAfterResearch(db))) return [];
    const indexed = await toolIdsForDocuments(db, builtDocumentIds);
    return [...new Set([...afterResearch, ...indexed])];
  } catch (error) {
    if (isTransientDbError(error)) {
      throw new RetryableError("Tool skills: the database could not be reached.", { retryAfter: RETRY_AFTER });
    }
    throw new FatalError("Tool skills: could not decide which tools to write for.");
  }
}
toolSkillTargetsStep.maxRetries = SKILL_STEP_MAX_RETRIES;

/**
 * Write (or skip) one tool's skill. The automatic pass (`research`) reads the
 * lab setting again here, so turning it off stops work already queued, and
 * honours the daily cap; Write skill (`manual`) honours the cap; the backfill
 * runs in its own script and never comes here.
 */
export async function writeToolSkillStep(toolId: string, trigger: ToolSkillTrigger, force: boolean): Promise<ToolSkillOutcome> {
  "use step";
  let outcome: ToolSkillOutcome;
  try {
    const db = await getDb();
    if (trigger === "research" && !(await skillsAfterResearch(db))) {
      return { status: "skipped", toolId, reason: "disabled" };
    }
    outcome = await writeToolSkill(db, toolId, { trigger, force, enforceCap: trigger !== "backfill" });
  } catch (error) {
    if (isTransientDbError(error)) {
      throw new RetryableError("Tool skill: the database could not be reached.", { retryAfter: RETRY_AFTER });
    }
    throw new FatalError(`Tool skill failed for tool ${toolId}.`);
  }
  if (outcome.status === "failed" && outcome.transient) {
    throw new RetryableError("Tool skill: the model could not answer this minute.", { retryAfter: RETRY_AFTER });
  }
  return outcome;
}
writeToolSkillStep.maxRetries = SKILL_STEP_MAX_RETRIES;

/**
 * After a tool's step gave up (its retries spent): one failed row, with the
 * reason, so the admin page says so and the automatic pass does not ask again
 * for the same inputs.
 */
export async function recordToolSkillFailureStep(toolId: string, trigger: ToolSkillTrigger, message: string): Promise<boolean> {
  "use step";
  try {
    return await recordStepFailure(await getDb(), toolId, trigger, message);
  } catch (error) {
    if (isTransientDbError(error)) {
      throw new RetryableError("Tool skill: the database could not be reached.", { retryAfter: RETRY_AFTER });
    }
    throw new FatalError(`Tool skill: could not record the failure for tool ${toolId}.`);
  }
}
recordToolSkillFailureStep.maxRetries = SKILL_STEP_MAX_RETRIES;

/** What one run of skills came to. */
export interface ToolSkillCounts {
  written: number;
  skipped: number;
  failed: number;
}

/** The run is done: one line of counts. */
export async function finishToolSkills(trigger: ToolSkillTrigger, counts: ToolSkillCounts): Promise<void> {
  "use step";
  console.info(`[skills] run finished: trigger=${trigger} written=${counts.written} skipped=${counts.skipped} failed=${counts.failed}`);
}
