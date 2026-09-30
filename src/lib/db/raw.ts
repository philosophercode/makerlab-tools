import type { SQL } from "drizzle-orm";
import type { Db } from "./types.ts";

/**
 * Rows from a raw SQL statement, typed by the caller.
 *
 * `Db` is the driver-agnostic `PgDatabase`, whose `execute()` cannot know the
 * driver's result shape and so returns `unknown`. Both drivers in use (Neon,
 * PGlite) return `{ rows }`, and this is the one place that fact is relied on.
 * Prefer the query builder; reach for this only where SQL has no builder
 * equivalent, such as `pg_trgm` similarity.
 */
export async function rawRows<T>(db: Db, query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] };
  return result.rows;
}
