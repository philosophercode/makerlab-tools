import { and, asc, eq, isNotNull, isNull, ne } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { pendingTools, tools, units } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import type { ResearchResult } from "../research/result.ts";

/**
 * The reads behind the assistant's cleanup work (assistant cleanup spec
 * 2026-10-28 §3): the catalogue's loose ends, listed so the assistant can
 * group them into proposal cards. Reads only; every change is an action.
 *
 * Relative `.ts` imports and no `"server-only"`, like the rest of `data/`.
 */

export interface UncategorizedTool {
  id: string;
  slug: string;
  name: string;
  officialName: string | null;
  published: boolean;
  /** The research the tool was approved from, if it came through intake. */
  research: ResearchResult | null;
  /** The category the imported list or the person gave, if any. */
  categoryHint: string | null;
}

/** Every tool not archived that has no category, by name, with the intake row it was approved from. */
export async function listUncategorizedTools(options: { db?: Db } = {}): Promise<UncategorizedTool[]> {
  const db = options.db ?? (await getDb());
  const rows = await db
    .select({
      id: tools.id,
      slug: tools.slug,
      name: tools.name,
      officialName: tools.officialName,
      published: tools.published,
      research: pendingTools.research,
      categoryHint: pendingTools.categoryHint,
    })
    .from(tools)
    .leftJoin(pendingTools, eq(pendingTools.createdToolId, tools.id))
    .where(and(isNull(tools.categoryId), isNull(tools.archivedAt)))
    .orderBy(asc(tools.name));

  // A tool can be the target of several intake rows (a unit added to it):
  // the first with research speaks for it.
  const byId = new Map<string, UncategorizedTool>();
  for (const row of rows) {
    const seen = byId.get(row.id);
    if (seen && (seen.research || !row.research)) continue;
    byId.set(row.id, {
      id: row.id,
      slug: row.slug,
      name: row.name,
      officialName: row.officialName,
      published: row.published,
      research: row.research ?? null,
      categoryHint: row.categoryHint ?? null,
    });
  }
  return [...byId.values()];
}

export interface ToolUnitLabels {
  toolId: string;
  toolSlug: string;
  toolName: string;
  units: { id: string; label: string; status: string }[];
}

/** Every unit not retired, grouped by its tool (tools not archived), by tool name then label. */
export async function listUnitLabels(options: { db?: Db } = {}): Promise<ToolUnitLabels[]> {
  const db = options.db ?? (await getDb());
  const rows = await db
    .select({
      toolId: tools.id,
      toolSlug: tools.slug,
      toolName: tools.name,
      unitId: units.id,
      label: units.unitLabel,
      status: units.status,
    })
    .from(units)
    .innerJoin(tools, eq(units.toolId, tools.id))
    .where(and(isNotNull(units.toolId), isNull(tools.archivedAt), ne(units.status, "retired")))
    .orderBy(asc(tools.name), asc(units.unitLabel));

  const byTool = new Map<string, ToolUnitLabels>();
  for (const row of rows) {
    let group = byTool.get(row.toolId);
    if (!group) {
      group = { toolId: row.toolId, toolSlug: row.toolSlug, toolName: row.toolName, units: [] };
      byTool.set(row.toolId, group);
    }
    group.units.push({ id: row.unitId, label: row.label, status: row.status });
  }
  return [...byTool.values()];
}
