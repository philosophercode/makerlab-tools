import "server-only";

import { z } from "zod";
import type { WriteToolSkillError } from "../../app/admin/inventory/[tool]/skill/action-result";
import { AI_AGENTS_PATH, type SkillWritingError } from "../../app/admin/settings/ai-agents/action-result";
import { setLabSetting, TOOL_SKILLS_SETTING } from "../data/lab-settings";
import { countToolSkillsSince } from "../data/tool-skills";
import { getDb } from "../db/client";
import { assembleSkillInputs, hasSkillMaterial } from "../skills/inputs";
import { SKILL_DAILY_LIMIT } from "../skills/limits";
import { toolSkillsSettingSchema, type ToolSkillsSetting } from "../skills/setting";
import { requestToolSkills } from "../skills/trigger";
import { defineAction } from "./define";

/**
 * Tool skills' two GUI writes (tool skills spec 2026-10-07 §3.2, §6;
 * assistant–GUI parity spec amendment of the same date).
 *
 * - **`skills.write`** — **Write skill / Rewrite skill** on a tool's skill
 *   page: starts the skill run for that tool now, forced (it writes even when
 *   nothing changed: the person asked). `tools.edit`, like the editor the page
 *   sits beside. **Spend**: a paid model call, so it honours the lab's daily
 *   cap here and again in the step.
 * - **`skills.set_after_research`** — "Write a tool skill after research" on
 *   Settings › AI agents. `users.manage`: like the research budget on the
 *   same page, a standing decision to spend the lab's money is a director's.
 *
 * Both GUI only (`assistant: "never"`): a skill is instructions the assistant
 * reads on its tool's page, so it never asks for its own, and the setting
 * spends with nobody pressing a button. No audit event, like `lab.set_notes`:
 * the skill's row records its trigger and the setting's row who set it.
 */

const tool = z.object({ toolId: z.string() });

const DAY_MS = 24 * 60 * 60_000;

export const SKILLS_WRITE = defineAction<{ toolId: string }, object, WriteToolSkillError>({
  id: "skills.write",
  toolName: "write_tool_skill",
  description:
    "Write or rewrite one tool's skill: its cited operating guide, written by AI from the lab's sources (a paid model call).",
  permission: "tools.edit",
  risk: "spend",
  assistant: "never",
  neverReason:
    "A tool skill is the operating guide the assistant itself reads on that tool's page, so it never asks for its own; staff write it on the tool's skill page",
  input: tool,
  invalidInput: "not_found",
  subject: (input) => ({ type: "tool", id: input.toolId }),
  check: async (input) => {
    const db = await getDb();
    const inputs = await assembleSkillInputs(db, input.toolId);
    if (!inputs) return "not_found";
    if (!hasSkillMaterial(inputs)) return "nothing_to_write";
    if ((await countToolSkillsSince(db, new Date(Date.now() - DAY_MS))) >= SKILL_DAILY_LIMIT) return "skill_daily_limit";
    return null;
  },
  run: async (input) => {
    const started = await requestToolSkills([input.toolId], "manual", { force: true });
    return started ? { ok: true, value: {}, committed: true } : { ok: false, error: "start_failed" };
  },
  // No page refresh: the skill appears when the run has written it, and the
  // page polls for it.
});

export const SKILLS_SET_AFTER_RESEARCH = defineAction<ToolSkillsSetting, object, SkillWritingError>({
  id: "skills.set_after_research",
  toolName: "set_skills_after_research",
  description: "Turn on or off writing a tool skill after a tool's research, for the whole lab.",
  permission: "users.manage",
  risk: "operational",
  assistant: "never",
  neverReason:
    "It decides the lab's spending on tool skills with nobody pressing a button each time; directors set it on Settings › AI agents",
  input: toolSkillsSettingSchema,
  invalidInput: "invalid_field",
  subject: () => ({ type: "lab_setting", id: TOOL_SKILLS_SETTING }),
  run: async (input, ctx) => {
    const outcome = await setLabSetting(TOOL_SKILLS_SETTING, { afterResearch: input.afterResearch }, ctx.identity.userId);
    return { ok: true, value: {}, ...(outcome.changed ? { committed: true } : {}) };
  },
  revalidate: [AI_AGENTS_PATH],
});
