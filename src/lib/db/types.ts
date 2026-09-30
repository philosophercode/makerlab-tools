import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema/index.ts";

/**
 * The database handle every query module takes. Both drivers — Neon in
 * production and preview, PGlite in tests and demo mode — produce a
 * `PgDatabase` over the same schema, so nothing outside `src/lib/db/` knows
 * which one it holds.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * Which driver `getDb()` will hand out (spec §3.2): Neon, PGlite persisted in
 * `PGLITE_DATA_DIR` (real data on a laptop), or in-memory PGlite with the demo
 * seed.
 */
export type DataSubstrate = "neon" | "pglite-local" | "pglite-demo";
