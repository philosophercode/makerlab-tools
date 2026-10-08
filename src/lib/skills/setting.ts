import { z } from "zod";
import { getLabSetting, TOOL_SKILLS_SETTING } from "../data/lab-settings.ts";
import type { Db } from "../db/types.ts";

/**
 * "Write a tool skill after research" (tool skills spec 2026-10-07 §4.4): one
 * `lab_settings` row, key `tool_skills`, value `{ afterResearch }`. Off by
 * default — no row, or one that no longer parses, is off — because it spends
 * the lab's money with nobody pressing a button. Directors turn it on from
 * Settings › AI agents (`skills.set_after_research`).
 *
 * Read when a step runs, not when the run was started, so turning it off stops
 * work already queued. Plain Node: the workflow step reads it.
 */

export const toolSkillsSettingSchema = z.object({
  afterResearch: z.boolean(),
});

export type ToolSkillsSetting = z.infer<typeof toolSkillsSettingSchema>;

export const TOOL_SKILLS_SETTING_DEFAULT: ToolSkillsSetting = { afterResearch: false };

/** The stored value, or the default when there is none or it no longer parses. */
export function readToolSkillsSetting(value: unknown): ToolSkillsSetting {
  const parsed = toolSkillsSettingSchema.safeParse(value);
  return parsed.success ? parsed.data : TOOL_SKILLS_SETTING_DEFAULT;
}

/** Whether skills are written after research on this deployment now. */
export async function skillsAfterResearch(db?: Db): Promise<boolean> {
  const setting = await getLabSetting(TOOL_SKILLS_SETTING, db ? { db } : {});
  return readToolSkillsSetting(setting?.value).afterResearch;
}
