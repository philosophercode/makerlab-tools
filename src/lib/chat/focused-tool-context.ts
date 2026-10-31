import { cacheLife, cacheTag } from "next/cache";
import { TOOL_CHAT_CACHE } from "../cache";
import { listToolManualsForChat, type ToolManualForChat } from "../data/manual-chunks";
import { listResourcesForTool, type ToolResource } from "../data/resources";
import { getDb } from "../db/client";
import { canSearchPrivateManuals, type ManualSearchViewer } from "../manuals/search";
import { readCurrentSkill, type ReadableSkill } from "../skills/read";
import type { ToolSkillForPrompt } from "../capabilities/types";
import { noToolManuals, toolManualsForChat, type ToolManualsForChat } from "./tool-manuals";
import { noToolSkill, toolSkillForPrompt } from "./tool-skill";

/**
 * What the chat knows about the tool whose page it is open on, beyond the
 * catalogue row: its manuals' search state and outlines (manual text spec
 * §3.6), its resources, for the manuals still attached whole, and its tool
 * skill (tool skills spec 2026-10-07 §5.6).
 *
 * The three reads are cached per tool ({@link TOOL_CHAT_CACHE}, tagged with the
 * catalogue), so the second and later turns of a conversation on a tool page
 * read none of them from Postgres. The manuals are cached per access level:
 * staff see private and hidden manuals, everyone else only public ones.
 *
 * **Never throws.** Each catch sits outside its cached read, so a failure is
 * never cached: a failed read gives that part's fallback for this turn (no
 * searchable manuals, no resources, no skill) and the next turn reads again.
 *
 * Only the chat route uses this. The starter-answer runs and the evals read
 * through the uncached loaders, which run outside Next.
 */
export interface FocusedToolContext {
  toolManuals: ToolManualsForChat;
  resources: ToolResource[];
  toolSkill: ToolSkillForPrompt | null;
}

export async function loadFocusedToolContext(
  tool: { id: string; name: string },
  viewer: ManualSearchViewer
): Promise<FocusedToolContext> {
  const [toolManuals, resources, toolSkill] = await Promise.all([
    cachedToolManuals(tool.id, canSearchPrivateManuals(viewer)).then(toolManualsForChat, noToolManuals),
    cachedToolResources(tool.id).catch((err: unknown) => {
      console.warn("[chat] failed to load resources for manuals", err);
      return [] as ToolResource[];
    }),
    cachedToolSkill(tool.id).then((skill) => toolSkillForPrompt(tool, skill), noToolSkill),
  ]);
  return { toolManuals, resources, toolSkill };
}

async function cachedToolManuals(toolId: string, includePrivate: boolean): Promise<ToolManualForChat[]> {
  "use cache";
  cacheTag("catalog");
  cacheLife(TOOL_CHAT_CACHE);

  return listToolManualsForChat(await getDb(), toolId, { includePrivate });
}

async function cachedToolResources(toolId: string): Promise<ToolResource[]> {
  "use cache";
  cacheTag("catalog");
  cacheLife(TOOL_CHAT_CACHE);

  return listResourcesForTool(toolId);
}

async function cachedToolSkill(toolId: string): Promise<ReadableSkill | null> {
  "use cache";
  cacheTag("catalog");
  cacheLife(TOOL_CHAT_CACHE);

  return readCurrentSkill(await getDb(), toolId);
}
