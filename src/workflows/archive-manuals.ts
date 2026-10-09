import {
  archiveManualStep,
  evalQuestionsStep,
  finishManualArchive,
  indexManualStep,
  type ManualArchiveCounts,
} from "../lib/manuals/steps.ts";
import { recordToolSkillFailureStep, toolSkillTargetsStep, writeToolSkillStep } from "../lib/skills/steps.ts";

/**
 * `archiveManuals` — copy each resource's manual PDF into Blob
 * (`src/lib/manuals/archive.ts`), one step per resource.
 *
 * Started, through `src/lib/manuals/start.ts`, after approving a tool (the
 * resources it created), after `create_tool` over MCP, after the tool editor
 * adds a resource or changes its link, and by the daily cron's backfill.
 *
 * After each archive, {@link indexManualStep} processes the resource's stored
 * PDFs into text (manual text spec §3.1, phase 1). Its outcome is counted
 * apart and can never turn an archive into a failure. Then, for each document
 * whose passages that step built, {@link evalQuestionsStep} writes its eval
 * questions (manual text spec amendment 2026-10-07), counted apart again.
 *
 * **Then the tool skills** (tool skills spec 2026-10-07 §5.4), when the lab
 * writes skills after research: one step decides the tools — `afterResearch`,
 * the tools an intake approval just created, then the tools whose passages
 * this run built — or none when the setting is off; then one
 * {@link writeToolSkillStep} per tool, skipped when nothing it reads changed.
 * Counted as `skillsWritten` / `skillsFailed`, never changing the counts
 * above.
 *
 * **Sequential, in the order given.** The body is replayed from the run's
 * event log after every step, and a replay must issue the same step calls in
 * the same order; a handful of PDFs does not need a pool. Each resource ends
 * independently: a step that is still failing after its retries counts as
 * failed and the rest are archived.
 */
export async function archiveManuals(resourceIds: string[], afterResearch: string[] = []): Promise<ManualArchiveCounts> {
  "use workflow";
  const counts: ManualArchiveCounts = {
    archived: 0,
    skipped: 0,
    failed: 0,
    indexed: 0,
    indexFailed: 0,
    passagesBuilt: 0,
    passagesFailed: 0,
    questionsWritten: 0,
    questionsFailed: 0,
    skillsWritten: 0,
    skillsFailed: 0,
  };
  const builtThisRun: string[] = [];
  for (const id of resourceIds) {
    let archived: Awaited<ReturnType<typeof archiveManualStep>> | null = null;
    try {
      archived = await archiveManualStep(id);
      counts[archived.status] += 1;
    } catch {
      counts.failed += 1;
    }
    if (!archived || !shouldIndex(archived)) continue;
    // Processing into text never changes what the archive counted.
    const built: string[] = [];
    try {
      for (const outcome of await indexManualStep(id)) {
        if (outcome.status === "indexed") counts.indexed += 1;
        else if (outcome.status === "failed") counts.indexFailed += 1;
        if (outcome.status !== "failed" && outcome.passages?.status === "built") {
          counts.passagesBuilt += 1;
          built.push(outcome.passages.documentId);
        }
        if (outcome.status !== "failed" && outcome.passages?.status === "failed") counts.passagesFailed += 1;
      }
    } catch {
      counts.indexFailed += 1;
    }
    if (built.length === 0) continue;
    builtThisRun.push(...built);
    // Eval questions for the documents just built: never changes the counts above.
    try {
      for (const outcome of await evalQuestionsStep(built)) {
        if (outcome.status === "written" || outcome.status === "copied") counts.questionsWritten += 1;
        else if (outcome.status === "failed") counts.questionsFailed += 1;
      }
    } catch {
      counts.questionsFailed += built.length;
    }
  }
  if (afterResearch.length > 0 || builtThisRun.length > 0) await writeSkills(afterResearch, builtThisRun, counts);
  await finishManualArchive(counts);
  return counts;
}

/**
 * The tail: the tools to write skills for (none when the setting is off), then
 * one step per tool. A plain function in workflow scope, not a step; a replay
 * repeats it exactly, every outcome being in the event log.
 */
async function writeSkills(afterResearch: string[], built: string[], counts: ManualArchiveCounts): Promise<void> {
  let targets: string[] = [];
  try {
    targets = await toolSkillTargetsStep(afterResearch, built);
  } catch {
    counts.skillsFailed += afterResearch.length;
    return;
  }
  for (const toolId of targets) {
    try {
      const outcome = await writeToolSkillStep(toolId, "research", false);
      if (outcome.status === "written") counts.skillsWritten += 1;
      else if (outcome.status === "failed") counts.skillsFailed += 1;
    } catch (error) {
      counts.skillsFailed += 1;
      try {
        await recordToolSkillFailureStep(toolId, "research", failureMessage(error));
      } catch {
        // The failure could not be stored either; the log line is what is left.
      }
    }
  }
}

/**
 * Whether the resource may now hold a PDF worth processing: it was just
 * archived, or it already held one (this link's copy, or a staff upload), or it
 * has no link to archive but may carry an uploaded file. Not after a failed
 * archive, and not for a resource that is not there.
 */
function shouldIndex(result: Awaited<ReturnType<typeof archiveManualStep>>): boolean {
  if (result.status === "archived") return true;
  if (result.status === "failed") return false;
  return result.reason !== "not_found";
}

/** A failed skill row's one line, read by shape (the workflow body's `Error` is not the host's). */
function failureMessage(reason: unknown): string {
  const message = typeof reason === "object" && reason !== null ? (reason as { message?: unknown }).message : reason;
  if (typeof message === "string" && message) return message.slice(0, 300);
  return "The skill could not be written.";
}
