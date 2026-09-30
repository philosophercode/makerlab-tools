import { and, count, eq, isNull } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { tools, units } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import type { UnitStatusCount } from "../kiosk/derive.ts";

/**
 * The kiosk's one read the catalogue does not already make (kiosk spec §4.1):
 * how many units of each *published*, unarchived tool hold each stored status.
 *
 * The catalogue's `MakerLabUnit.status` folds `under_maintenance`,
 * `out_of_service` and `retired` into one display word, and the kiosk needs
 * them apart — "under maintenance" is not "out of service", and a retired unit
 * counts toward neither side of "1 of 2 down". One grouped statement, whatever
 * the size of the inventory; counts only.
 *
 * Relative imports with `.ts` extensions and no `"server-only"`, like the rest
 * of `src/lib/data/`.
 */
export async function listUnitStatusCounts(db?: Db): Promise<UnitStatusCount[]> {
  const handle = db ?? (await getDb());
  const rows = await handle
    .select({ toolId: units.toolId, status: units.status, count: count() })
    .from(units)
    .innerJoin(tools, eq(units.toolId, tools.id))
    .where(and(eq(tools.published, true), isNull(tools.archivedAt)))
    .groupBy(units.toolId, units.status);
  return rows.flatMap((row) =>
    row.toolId ? [{ toolId: row.toolId, status: String(row.status ?? ""), count: Number(row.count) }] : []
  );
}
