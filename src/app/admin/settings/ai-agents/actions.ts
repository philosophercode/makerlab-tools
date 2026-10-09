"use server";

import { performAction } from "../../../../lib/actions/perform";
import { SKILLS_SET_AFTER_RESEARCH } from "../../../../lib/actions/skills";
import { resolveIdentityFromHeaders } from "../../../../lib/auth/identity";
import type { SkillWritingResult } from "./action-result";

/**
 * "Write a tool skill after research" (tool skills spec 2026-10-07 §6): a
 * one-line wrapper over `skills.set_after_research`, gated on `users.manage`
 * by `performAction`.
 */
export async function setSkillWriting(input: { afterResearch: boolean }): Promise<SkillWritingResult> {
  return performAction(SKILLS_SET_AFTER_RESEARCH, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}
