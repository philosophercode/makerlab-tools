import { extractJsonObject } from "../research/model-output.ts";
import {
  draftBulletSchema,
  draftTroubleSchema,
  emptyDraft,
  SKILL_BULLET_SECTIONS,
  SKILL_SECTION_MAX,
  type SkillDraft,
} from "./format.ts";

/**
 * Read the skill writer's answer (tool skills spec 2026-10-07 §5.2): one JSON
 * object with a list per section. Pure.
 *
 * **Lenient item by item, strict about the whole.** An item that does not
 * parse (no text, a wrong type, too long) is dropped and the rest are kept: a
 * guide missing one bad line is still a guide. An answer with no JSON object,
 * or with none of the section lists, is unreadable (`null`), and the writer
 * stores a failed attempt. Each list is cut to its cap. What the items *say*
 * is checked afterwards, by the numbers guard (`numbers-guard.ts`).
 */

export interface ParsedDraft {
  draft: SkillDraft;
  /** Items dropped because they did not parse. */
  malformed: number;
}

const NOT_IN_SOURCES_MAX_CHARS = 200;

export function parseSkillDraft(text: string): ParsedDraft | null {
  let raw: unknown;
  try {
    raw = extractJsonObject(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const object = raw as Record<string, unknown>;
  const known = [...SKILL_BULLET_SECTIONS, "troubleshooting", "notInSources"].filter((key) => Array.isArray(object[key]));
  if (known.length === 0) return null;

  const draft = emptyDraft();
  let malformed = 0;
  for (const key of SKILL_BULLET_SECTIONS) {
    for (const item of asArray(object[key])) {
      const parsed = draftBulletSchema.safeParse(item);
      if (parsed.success) draft[key].push(parsed.data);
      else malformed += 1;
    }
    draft[key] = draft[key].slice(0, SKILL_SECTION_MAX[key]);
  }
  for (const item of asArray(object.troubleshooting)) {
    const parsed = draftTroubleSchema.safeParse(item);
    if (parsed.success) draft.troubleshooting.push(parsed.data);
    else malformed += 1;
  }
  draft.troubleshooting = draft.troubleshooting.slice(0, SKILL_SECTION_MAX.troubleshooting);
  for (const item of asArray(object.notInSources)) {
    const line = typeof item === "string" ? item.replace(/\s+/g, " ").trim() : "";
    if (line && line.length <= NOT_IN_SOURCES_MAX_CHARS) draft.notInSources.push(line);
    else malformed += 1;
  }
  draft.notInSources = [...new Set(draft.notInSources)].slice(0, SKILL_SECTION_MAX.notInSources);
  return { draft, malformed };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
