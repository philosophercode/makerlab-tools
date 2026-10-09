import type { ToolSkillTrigger } from "../lib/db/schema/vocabulary.ts";
import { finishToolSkills, recordToolSkillFailureStep, writeToolSkillStep, type ToolSkillCounts } from "../lib/skills/steps.ts";

/**
 * `writeToolSkills` — write or refresh tool skills, one step per tool (tool
 * skills spec 2026-10-07 §5.3, §5.4).
 *
 * Started through `src/lib/skills/start.ts` by **Write skill / Rewrite skill**
 * (`trigger: "manual"`, `force: true`) and by an intake approval that started
 * no manual archive run (`trigger: "research"`). An approval that did start
 * one has that run write the skill at its end, after the manuals are indexed
 * (`archive-manuals.ts`).
 *
 * **Sequential, in the order given**, for the reason every workflow here
 * gives: the body is replayed from the run's event log and must issue the same
 * steps in the same order. Each tool ends on its own: a step still failing
 * after its retries stores one failed row and the rest go on.
 */
export async function writeToolSkills(toolIds: string[], trigger: ToolSkillTrigger, force = false): Promise<ToolSkillCounts> {
  "use workflow";
  const counts: ToolSkillCounts = { written: 0, skipped: 0, failed: 0 };
  for (const id of toolIds) {
    try {
      const outcome = await writeToolSkillStep(id, trigger, force);
      if (outcome.status === "written") counts.written += 1;
      else if (outcome.status === "failed") counts.failed += 1;
      else counts.skipped += 1;
    } catch (error) {
      counts.failed += 1;
      try {
        await recordToolSkillFailureStep(id, trigger, failureMessage(error));
      } catch {
        // The failure could not be stored either; the log line is what is left.
      }
    }
  }
  await finishToolSkills(trigger, counts);
  return counts;
}

/**
 * The one line a failed row says. The steps throw errors written for it; read
 * by shape, because the workflow body's `Error` is not the host's.
 */
function failureMessage(reason: unknown): string {
  const message = typeof reason === "object" && reason !== null ? (reason as { message?: unknown }).message : reason;
  if (typeof message === "string" && message) return message.slice(0, 300);
  return "The skill could not be written.";
}
