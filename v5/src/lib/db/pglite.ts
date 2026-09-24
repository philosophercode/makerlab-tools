import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema/index.ts";
import { migrationsFolder } from "./migrations-folder.ts";
import type { Db } from "./types.ts";
import { acquirePgliteLock, releasePgliteLock } from "./pglite-lock.ts";

/**
 * An in-process Postgres (spec §3.2). PGlite is Postgres compiled to
 * WebAssembly: real SQL, real constraints, real triggers, and no network. It
 * serves the test suite, E2E, local development without `DATABASE_URL`, and
 * demo mode — and it is what keeps constitution Article 3 true.
 *
 * An in-memory instance starts empty and runs the same committed migrations Neon
 * runs, so a schema mistake shows up in a unit test before it reaches a deploy.
 */
/**
 * The extensions every PGlite instance loads: `pg_trgm` (the duplicate check,
 * migration 0000) and pgvector (`vector`, manual passages' embeddings,
 * migration 0011 — manual text spec §4). Neon ships both; PGlite has to be
 * handed them at construction, before the migrations' `CREATE EXTENSION`.
 */
export const PGLITE_EXTENSIONS = { pg_trgm, vector };

export interface PgliteOptions {
  /** Runs once, after migrations, on a fresh database. */
  seed?: (db: Db) => Promise<void>;
}

export async function createPgliteDb(options: PgliteOptions = {}): Promise<Db> {
  const client = new PGlite({ extensions: PGLITE_EXTENSIONS });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: migrationsFolder() });
  if (options.seed) await options.seed(db);
  return db;
}

export interface PersistentPglite {
  db: Db;
  /** Shut Postgres down cleanly and release the directory's lock. */
  close(): Promise<void>;
}

/**
 * A PGlite database that lives on disk under `dir` (`PGLITE_DATA_DIR`, see
 * `local-dir.ts`): created if missing, migrated on every open (migrations are
 * idempotent), and never seeded — it holds whatever was imported into it.
 *
 * The cluster itself is `dir/pgdata`; `dir/lock` names the one process allowed
 * to open it (`pglite-lock.ts`). Throws `PgliteLockedError` when another
 * running process holds the lock.
 */
export async function openPersistentPglite(dir: string): Promise<PersistentPglite> {
  acquirePgliteLock(dir);
  try {
    const client = new PGlite({ dataDir: join(dir, "pgdata"), extensions: PGLITE_EXTENSIONS });
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: migrationsFolder() });
    return {
      db,
      async close() {
        await client.close();
        releasePgliteLock(dir);
      },
    };
  } catch (error) {
    releasePgliteLock(dir);
    throw error;
  }
}
