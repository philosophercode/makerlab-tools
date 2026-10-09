"use server";

import { performAction } from "../../../../../lib/actions/perform";
import { SKILLS_WRITE } from "../../../../../lib/actions/skills";
import { resolveIdentityFromHeaders } from "../../../../../lib/auth/identity";
import type { WriteToolSkillResult } from "./action-result";

/**
 * **Write skill / Rewrite skill** (tool skills spec 2026-10-07 §6): a one-line
 * wrapper over `skills.write` (`src/lib/actions/skills.ts`), gated on
 * `tools.edit` by `performAction`.
 */
export async function writeSkill(input: { toolId: string }): Promise<WriteToolSkillResult> {
  return performAction(SKILLS_WRITE, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}
