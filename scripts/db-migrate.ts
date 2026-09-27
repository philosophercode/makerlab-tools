/**
 * Apply committed migrations (data platform design spec 2026-09-14 §3.2).
 *
 *   npm run db:migrate
 *
 * Reads `DATABASE_URL` from the environment (`.env.local` locally; the Vercel
 * project's variables in a deploy). With it unset and `PGLITE_DATA_DIR` set,
 * migrates that local PGlite directory instead (stop the dev server first —
 * it is single-process). Exits 0 with a note when neither is set, so a build
 * without a database — a fresh clone, a preview without Neon — still succeeds.
 * The in-memory demo PGlite never needs this: it migrates itself on first use.
 */
import { createNeonDb, migrateNeon } from "../src/lib/db/neon.ts";
import { localDataDir } from "../src/lib/db/local-dir.ts";
import { openPersistentPglite } from "../src/lib/db/pglite.ts";
import { PgliteLockedError } from "../src/lib/db/pglite-lock.ts";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const db = createNeonDb(url);
    await migrateNeon(db);
    console.log("Migrations applied.");
    return;
  }
  const dir = localDataDir();
  if (dir) {
    // Opening a local directory migrates it.
    const local = await openPersistentPglite(dir);
    await local.close();
    console.log(`Migrations applied to the local PGlite database at ${dir}.`);
    return;
  }
  console.log("DATABASE_URL is not set; no migrations to run.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof PgliteLockedError ? error.message : error);
    process.exit(1);
  });
