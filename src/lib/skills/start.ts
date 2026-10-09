import { start } from "workflow/api";
import type { ToolSkillTrigger } from "../db/schema/vocabulary.ts";
import { writeToolSkills } from "../../workflows/tool-skills.ts";

/**
 * Starting `writeToolSkills` — the one module that imports `workflow/api` for
 * tool skills (tool skills spec 2026-10-07 §5.4). Callers reach it through
 * `trigger.ts`'s dynamic `import()`, so nothing that only might write a skill
 * loads the workflow runtime.
 *
 * True when the run was started. Starting is not writing: what each tool came
 * to is in the run's result, its log line and its rows.
 */
export async function startToolSkills(toolIds: readonly string[], trigger: ToolSkillTrigger, force: boolean): Promise<boolean> {
  try {
    await start(writeToolSkills, [[...toolIds], trigger, force]);
    return true;
  } catch (error) {
    const name = error instanceof Error ? error.name : "unknown error";
    console.error(`[skills] could not start a skill run for ${toolIds.length} tool(s): ${name}`);
    return false;
  }
}
