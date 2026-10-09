import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { tools, units } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";

/**
 * The machines that cannot be used right now, for the overview's **Need to
 * know** (admin sections spec 2026-10-07): units out of service or under
 * maintenance, on tools that are not archived. Out of service first (the
 * worse state), then by tool and unit name.
 *
 * Staff only: the overview reads it for `maintenance.manage` holders. No
 * serial numbers, no notes: a unit's name and its tool are what the row shows.
 * Bounded like every list a person reads (Article 4).
 */

export const UNITS_DOWN_STATUSES = ["out_of_service", "under_maintenance"] as const;
export type UnitDownStatus = (typeof UNITS_DOWN_STATUSES)[number];

export interface UnitDown {
  id: string;
  unitLabel: string;
  status: UnitDownStatus;
  toolId: string;
  toolName: string;
  toolSlug: string;
}

const LIMIT = 50;

export async function listUnitsDown(options: { db?: Db } = {}): Promise<UnitDown[]> {
  const db = options.db ?? (await getDb());
  const rows = await db
    .select({
      id: units.id,
      unitLabel: units.unitLabel,
      status: units.status,
      toolId: tools.id,
      toolName: tools.name,
      toolSlug: tools.slug,
    })
    .from(units)
    .innerJoin(tools, eq(units.toolId, tools.id))
    .where(and(inArray(units.status, [...UNITS_DOWN_STATUSES]), isNull(tools.archivedAt)))
    .orderBy(sql`case ${units.status} when 'out_of_service' then 0 else 1 end`, asc(tools.name), asc(units.unitLabel))
    .limit(LIMIT);
  return rows.map((row) => ({ ...row, status: row.status as UnitDownStatus }));
}
