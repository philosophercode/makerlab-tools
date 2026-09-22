import { asc, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { categories, locations } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";

/**
 * Categories and locations as lists (spec §4.3).
 *
 * Everywhere else in the app these two tables are only ever *joined* — the
 * catalogue reads a tool's category through its row and never asks what
 * categories exist. An editing surface has to ask: a select needs its options,
 * and a filter needs the whole vocabulary rather than whatever the rows on
 * screen happen to use.
 *
 * Both are small, stable lists (tens of rows), read whole and unbounded for
 * that reason.
 *
 * Relative imports with `.ts` extensions and no `@/` alias, and no
 * `"server-only"`: `scripts/` loads these modules under plain Node.
 */

export interface CategoryOption {
  id: string;
  name: string;
  /** The heading a category sits under, or null — many have none. */
  group: string | null;
}

export interface LocationOption {
  id: string;
  room: string;
  zone: string;
  /** The printed label on the floor map (`ML-RESIN-01`), or null. */
  mapTag: string | null;
}

export interface TaxonomyQueryOptions {
  /** A handle to use instead of {@link getDb} — tests pass an isolated one. */
  db?: Db;
}

/**
 * Every category, grouped ones first and each group's members alphabetical.
 *
 * `nulls last` is the whole point of the ordering clause: an ungrouped category
 * is the exception, and a select that opens on the exceptions reads as broken.
 */
export async function listCategories(
  options: TaxonomyQueryOptions = {}
): Promise<CategoryOption[]> {
  const db = options.db ?? (await getDb());

  return db
    .select({ id: categories.id, name: categories.name, group: categories.group })
    .from(categories)
    .orderBy(sql`${categories.group} asc nulls last`, asc(categories.name));
}

/** Every location, by room then zone — the order somebody walking the lab uses. */
export async function listLocations(
  options: TaxonomyQueryOptions = {}
): Promise<LocationOption[]> {
  const db = options.db ?? (await getDb());

  return db
    .select({
      id: locations.id,
      room: locations.room,
      zone: locations.zone,
      mapTag: locations.mapTag,
    })
    .from(locations)
    .orderBy(asc(locations.room), asc(locations.zone));
}
