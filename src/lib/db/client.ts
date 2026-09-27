import { sql } from "drizzle-orm";
import { createNeonDb } from "./neon.ts";
import { createPgliteDb, openPersistentPglite } from "./pglite.ts";
import { localDataDir } from "./local-dir.ts";
import { seedDemo } from "./demo-seed.ts";
import type { DataSubstrate, Db } from "./types.ts";

/**
 * The one entry point to the database (spec §3.2).
 *
 * - `DATABASE_URL` set → Neon. Created lazily on first call, so `next build`
 *   never needs the variable and a missing one fails at request time with
 *   {@link DbUnavailableError}, never at build time.
 * - `DATABASE_URL` unset, `PGLITE_DATA_DIR` set → PGlite persisted in that
 *   directory, migrated and never seeded: real data (a local Notion import) on
 *   a laptop. Local only — refused on Vercel and in production builds
 *   (`local-dir.ts`), and one process at a time (`pglite-lock.ts`), so the dev
 *   server must be stopped while `npm run import:notion` writes to it.
 * - Neither → in-memory PGlite with the demo seed: tests, E2E, a fresh clone.
 *   The `DemoDataBanner` tells visitors the catalogue is sample data.
 *
 * The handle is memoised on `globalThis` so Next's dev-server module reloads
 * reuse one PGlite instance instead of starting a new one per reload. There is
 * deliberately no `Proxy` wrapper: libraries that inspect the handle (Better
 * Auth's adapter among them) break on one.
 *
 * Not `server-only`: the import and migrate scripts load this module under
 * plain Node, where that package cannot resolve. Nothing under `src/lib/db/`
 * is imported by client components.
 */

/** Neon is configured but cannot be reached; callers fail toward stale, not wrong (Article 4). */
export class DbUnavailableError extends Error {
  constructor(cause: unknown) {
    super("The database is unavailable.", { cause });
    this.name = "DbUnavailableError";
  }
}

/** Throws when `PGLITE_DATA_DIR` is set on Vercel or in production (see `localDataDir`). */
export function dataSubstrate(): DataSubstrate {
  if (process.env.DATABASE_URL) return "neon";
  return localDataDir() ? "pglite-local" : "pglite-demo";
}

function openDb(substrate: DataSubstrate): Promise<Db> {
  switch (substrate) {
    case "neon":
      return Promise.resolve(createNeonDb(process.env.DATABASE_URL as string));
    case "pglite-local":
      return openPersistentPglite(localDataDir() as string).then((local) => local.db);
    default:
      return createPgliteDb({ seed: seedDemo });
  }
}

type DbCache = { key: string; promise: Promise<Db> } | undefined;
const CACHE_KEY = "__makerlab_db__" as const;

function cache(): DbCache {
  return (globalThis as Record<string, unknown>)[CACHE_KEY] as DbCache;
}

function setCache(value: DbCache): void {
  (globalThis as Record<string, unknown>)[CACHE_KEY] = value;
}

/**
 * Keyed on the substrate and, for the local one, its directory. A failed open
 * is not memoised: a local directory locked by `npm run import:notion` works
 * on the first request after the import finishes, with no restart.
 */
export function getDb(): Promise<Db> {
  const substrate = dataSubstrate();
  const key = substrate === "pglite-local" ? `${substrate}:${localDataDir()}` : substrate;
  const cached = cache();
  if (cached && cached.key === key) return cached.promise;

  const promise = openDb(substrate);
  setCache({ key, promise });
  promise.catch(() => {
    if (cache()?.promise === promise) setCache(undefined);
  });
  return promise;
}

/**
 * One round trip. Throws {@link DbUnavailableError} when Neon cannot be
 * reached, which is what `/api/health` reports.
 */
export async function pingDb(): Promise<void> {
  const db = await getDb();
  try {
    await db.execute(sql`select 1`);
  } catch (error) {
    throw new DbUnavailableError(error);
  }
}

/** Drop the memoised handle so a test can change `DATABASE_URL` and start over. */
export function resetDbForTests(): void {
  setCache(undefined);
}
