import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { categories, locations } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import { isUniqueViolation } from "./pg-errors.ts";

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

// ── Finding or creating ─────────────────────────────────────────────

/**
 * The category named `name` in `group`, created if there is none (spec §5.4:
 * approving a researched tool may propose a category the lab does not have).
 *
 * The match is the one `categories_name_group_key` enforces —
 * case-insensitive on the name and on the group, a null group being its own
 * value — so "fdm" in "3d printing" finds "FDM" in "3D Printing" rather than
 * making a near-twin.
 *
 * Select, then insert, then select again on a unique violation: somebody may
 * create the same category between the first two statements, and the index is
 * the arbiter. The insert runs in a savepoint (`db.transaction` on a
 * transaction handle), so a lost race does not abort the caller's transaction.
 * Takes its handle explicitly for that reason — approval calls this inside the
 * transaction that creates the tool.
 */
export async function findOrCreateCategory(
  db: Db,
  input: { name: string; group: string | null }
): Promise<{ id: string; created: boolean }> {
  const name = input.name.trim();
  const group = input.group?.trim() || null;
  if (!name) throw new Error("findOrCreateCategory: a category needs a name");

  const find = async () => {
    const [row] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(sql`lower(${categories.name})`, name.toLowerCase()),
          eq(sql`lower(coalesce(${categories.group}, ''))`, (group ?? "").toLowerCase())
        )
      )
      .limit(1);
    return row?.id ?? null;
  };

  const existing = await find();
  if (existing) return { id: existing, created: false };

  try {
    const id = await db.transaction(async (savepoint) => {
      const [row] = await savepoint
        .insert(categories)
        .values({ name, group })
        .returning({ id: categories.id });
      return row.id;
    });
    return { id, created: true };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const raced = await find();
    if (!raced) throw err;
    return { id: raced, created: false };
  }
}

/**
 * The location at `room` / `zone`, created if there is none — the same
 * select, insert, select-again shape as {@link findOrCreateCategory}, matched
 * the way `locations_room_zone_key` is: case-insensitively on both.
 */
export async function findOrCreateLocation(
  db: Db,
  input: { room: string; zone: string }
): Promise<{ id: string; created: boolean }> {
  const room = input.room.trim();
  const zone = input.zone.trim();
  if (!room || !zone) throw new Error("findOrCreateLocation: a location needs a room and a zone");

  const find = async () => {
    const [row] = await db
      .select({ id: locations.id })
      .from(locations)
      .where(
        and(
          eq(sql`lower(${locations.room})`, room.toLowerCase()),
          eq(sql`lower(${locations.zone})`, zone.toLowerCase())
        )
      )
      .limit(1);
    return row?.id ?? null;
  };

  const existing = await find();
  if (existing) return { id: existing, created: false };

  try {
    const id = await db.transaction(async (savepoint) => {
      const [row] = await savepoint
        .insert(locations)
        .values({ room, zone })
        .returning({ id: locations.id });
      return row.id;
    });
    return { id, created: true };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const raced = await find();
    if (!raced) throw err;
    return { id: raced, created: false };
  }
}
