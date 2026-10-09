import type { ToolSkillForPrompt } from "../capabilities/types";
import { getDb } from "../db/client";
import { readCurrentSkill } from "../skills/read";
import { SKILL_PROMPT_MAX_CHARS } from "../skills/limits";
import { renderSkillCompact } from "../skills/render";

/**
 * The focused tool's skill for the chat's prompt on its page (tool skills spec
 * 2026-10-07 §5.6; the owner: "assistant should load it in chat if on tool").
 *
 * One indexed query per turn on a tool page, like the manual outlines beside
 * it. The skill is re-rendered compactly from its stored sections within
 * {@link SKILL_PROMPT_MAX_CHARS}; a row whose sections no longer parse gives
 * its stored markdown, cut to the budget. Only the current (`ready`) skill:
 * a tool whose latest attempt failed keeps its last good skill, and a tool
 * with none gets nothing. **Never throws**: a failed read leaves the turn
 * without the skill and says so in the log, never fails the answer.
 */
export async function loadToolSkillForChat(
  tool: { id: string; name: string },
  maxChars: number = SKILL_PROMPT_MAX_CHARS
): Promise<ToolSkillForPrompt | null> {
  try {
    const skill = await readCurrentSkill(await getDb(), tool.id);
    if (!skill) return null;
    const text = skill.sections
      ? renderSkillCompact({ toolName: tool.name, version: skill.version, generatedAt: skill.generatedAt }, skill.sections, skill.sources, maxChars)
      : skill.content.slice(0, maxChars);
    return { toolName: tool.name, version: skill.version, generatedAt: skill.generatedAt, text };
  } catch (err) {
    console.warn(`[chat] could not read the tool skill; answering without it: ${err instanceof Error ? err.name : "error"}`);
    return null;
  }
}
