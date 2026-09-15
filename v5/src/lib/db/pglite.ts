import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema/index.ts";
import { migrationsFolder } from "./migrations-folder.ts";
import type { Db } from "./types.ts";

/**
 * An in-process Postgres (spec §3.2). PGlite is Postgres compiled to
 * WebAssembly: real SQL, real constraints, real triggers, and no network. It
 * serves the test suite, E2E, local development without `DATABASE_URL`, and
 * demo mode — and it is what keeps constitution Article 3 true.
 *
 * Every instance starts empty and runs the same committed migrations Neon
 * runs, so a schema mistake shows up in a unit test before it reaches a deploy.
 */
export interface PgliteOptions {
  /** Runs once, after migrations, on a fresh database. */
  seed?: (db: Db) => Promise<void>;
}

export async function createPgliteDb(options: PgliteOptions = {}): Promise<Db> {
  const client = new PGlite({ extensions: { pg_trgm } });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: migrationsFolder() });
  if (options.seed) await options.seed(db);
  return db;
}
