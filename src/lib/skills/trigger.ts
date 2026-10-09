import { isUuid } from "../data/uuid.ts";
import type { Db } from "../db/types.ts";
import type { ToolSkillTrigger } from "../db/schema/vocabulary.ts";
import { skillsAfterResearch } from "./setting.ts";

/**
 * Asking for tool skills (tool skills spec 2026-10-07 §5.4).
 *
 * **Neither function throws, and neither fails the write that called it**
 * (Article 4): the tool exists either way, and a skill that could not be
 * started is written by the next trigger, Rewrite or the backfill. Every
 * failure leaves one log line and `false`. `start.ts` comes in by a dynamic
 * `import()`, so `workflow/api` stays out of the callers' static graph.
 */

/** Start a skill run for these tools now (Write skill: `manual`, forced). */
export async function requestToolSkills(
  toolIds: readonly string[],
  trigger: ToolSkillTrigger,
  options: { force?: boolean } = {}
): Promise<boolean> {
  const ids = [...new Set(toolIds.filter(isUuid))];
  if (ids.length === 0) return false;
  try {
    const { startToolSkills } = await import("./start.ts");
    return await startToolSkills(ids, trigger, options.force ?? false);
  } catch {
    console.error("[skills] could not request a skill run");
    return false;
  }
}

/**
 * Whether the pass after research is on — read for an approval, which then
 * hands its new tool to the manual archive run (or starts a skill run itself
 * when it started none). Off on any failure to read.
 */
export async function skillsAfterResearchSafe(db?: Db): Promise<boolean> {
  try {
    return await skillsAfterResearch(db);
  } catch {
    console.warn("[skills] could not read the skill setting; treating it as off");
    return false;
  }
}
