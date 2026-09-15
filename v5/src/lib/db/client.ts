import { sql } from "drizzle-orm";
import { createNeonDb } from "./neon.ts";
import { createPgliteDb } from "./pglite.ts";
import { seedDemo } from "./demo-seed.ts";
import type { DataSubstrate, Db } from "./types.ts";

/**
 * The one entry point to the database (spec §3.2).
 *
 * - `DATABASE_URL` set → Neon. Created lazily on first call, so `next build`
 *   never needs the variable and a missing one fails at request time with
 *   {@link DbUnavailableError}, never at build time.
 * - `DATABASE_URL` unset → PGlite with the demo seed: tests, E2E, a fresh
 *   clone. The `DemoDataBanner` tells visitors the catalogue is sample data.
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

export function dataSubstrate(): DataSubstrate {
  return process.env.DATABASE_URL ? "neon" : "pglite-demo";
}

type DbCache = { substrate: DataSubstrate; promise: Promise<Db> } | undefined;
const CACHE_KEY = "__makerlab_db__" as const;

function cache(): DbCache {
  return (globalThis as Record<string, unknown>)[CACHE_KEY] as DbCache;
}

function setCache(value: DbCache): void {
  (globalThis as Record<string, unknown>)[CACHE_KEY] = value;
}

export function getDb(): Promise<Db> {
  const substrate = dataSubstrate();
  const cached = cache();
  if (cached && cached.substrate === substrate) return cached.promise;

  const promise =
    substrate === "neon"
      ? Promise.resolve(createNeonDb(process.env.DATABASE_URL as string))
      : createPgliteDb({ seed: seedDemo });
  setCache({ substrate, promise });
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
