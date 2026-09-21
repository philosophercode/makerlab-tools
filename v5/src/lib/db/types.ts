import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema/index.ts";

/**
 * The database handle every query module takes. Both drivers — Neon in
 * production and preview, PGlite in tests and demo mode — produce a
 * `PgDatabase` over the same schema, so nothing outside `src/lib/db/` knows
 * which one it holds.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Which driver `getDb()` will hand out (spec §3.2). */
export type DataSubstrate = "neon" | "pglite-demo";
