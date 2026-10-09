import { currentToolSkill, latestToolSkill, type ToolSkillRow } from "../data/tool-skills.ts";
import type { Db } from "../db/types.ts";
import { skillSectionsSchema, skillSourcesSchema, type SkillSections, type SkillSource } from "./format.ts";

/**
 * A tool's current skill as its readers take it (tool skills spec 2026-10-07
 * §5.5, §5.6, §6): `get_tool_skill`, the chat's prompt on a tool page and the
 * admin page. The stored JSON is validated here; a row whose sections no
 * longer parse still serves its markdown, and the chat falls back to that.
 * Plain Node.
 */

export interface ReadableSkill {
  id: string;
  version: number;
  /** ISO 8601. */
  generatedAt: string;
  model: string;
  costUsd: number;
  trigger: ToolSkillRow["trigger"];
  inputHash: string;
  /** The rendered markdown. */
  content: string;
  /** The structured skill, or null when the stored JSON no longer parses. */
  sections: SkillSections | null;
  sources: SkillSource[];
}

export function readableSkill(row: ToolSkillRow): ReadableSkill {
  const sections = skillSectionsSchema.safeParse(row.sections);
  const sources = skillSourcesSchema.safeParse(row.sources);
  return {
    id: row.id,
    version: row.version,
    generatedAt: row.createdAt.toISOString(),
    model: row.model,
    costUsd: row.costUsd,
    trigger: row.trigger,
    inputHash: row.inputHash,
    content: row.content,
    sections: sections.success ? sections.data : null,
    sources: sources.success ? sources.data : [],
  };
}

/** The tool's current (latest ready) skill, readable, or null. */
export async function readCurrentSkill(db: Db, toolId: string): Promise<ReadableSkill | null> {
  const row = await currentToolSkill(db, toolId);
  return row ? readableSkill(row) : null;
}

/** The current skill and the latest attempt — the admin page shows a failure after the last good skill. */
export async function readSkillHistory(db: Db, toolId: string): Promise<{ current: ReadableSkill | null; latest: ToolSkillRow | null }> {
  const [current, latest] = await Promise.all([currentToolSkill(db, toolId), latestToolSkill(db, toolId)]);
  return { current: current ? readableSkill(current) : null, latest };
}
