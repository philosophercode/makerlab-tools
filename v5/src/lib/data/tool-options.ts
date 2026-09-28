import { asc, isNull } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { tools, units } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";

/**
 * Every tool still in the lab, with its units — the choices **Log completed
 * maintenance** offers (assistant–GUI parity spec §11 answer 5). Drafts
 * included (a machine on the floor before its page is published still gets
 * serviced), archived tools and retired units not.
 *
 * Two statements whatever the size of the inventory.
 */

export interface ToolUnitOption {
  id: string;
  name: string;
  units: { id: string; label: string }[];
}

export async function listToolUnitOptions(options: { db?: Db } = {}): Promise<ToolUnitOption[]> {
  const db = options.db ?? (await getDb());
  const [toolRows, unitRows] = await Promise.all([
    db.select({ id: tools.id, name: tools.name }).from(tools).where(isNull(tools.archivedAt)).orderBy(asc(tools.name)),
    db
      .select({ id: units.id, label: units.unitLabel, toolId: units.toolId, status: units.status })
      .from(units)
      .orderBy(asc(units.unitLabel)),
  ]);
  const byTool = new Map<string, { id: string; label: string }[]>();
  for (const unit of unitRows) {
    if (!unit.toolId || unit.status === "retired") continue;
    const list = byTool.get(unit.toolId) ?? [];
    list.push({ id: unit.id, label: unit.label });
    byTool.set(unit.toolId, list);
  }
  return toolRows.map((tool) => ({ id: tool.id, name: tool.name, units: byTool.get(tool.id) ?? [] }));
}
