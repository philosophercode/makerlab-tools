import type { ToolSkillForPrompt } from "../capabilities/types";
import type { ReadableSkill } from "../skills/read";
import { SKILL_PROMPT_MAX_CHARS } from "../skills/limits";
import { renderSkillCompact } from "../skills/render";

/** A stored skill as the prompt carries it, within `maxChars`; null for none. */
export function toolSkillForPrompt(
  tool: { name: string },
  skill: ReadableSkill | null,
  maxChars: number = SKILL_PROMPT_MAX_CHARS
): ToolSkillForPrompt | null {
  if (!skill) return null;
  const text = skill.sections
    ? renderSkillCompact({ toolName: tool.name, version: skill.version, generatedAt: skill.generatedAt }, skill.sections, skill.sources, maxChars)
    : skill.content.slice(0, maxChars);
  return { toolName: tool.name, version: skill.version, generatedAt: skill.generatedAt, text };
}

/** No skill, after a failed read: the turn answers without it. */
export function noToolSkill(err: unknown): null {
  console.warn(`[chat] could not read the tool skill; answering without it: ${err instanceof Error ? err.name : "error"}`);
  return null;
}
