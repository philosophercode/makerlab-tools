/**
 * Apply committed migrations to the Neon database (data platform design spec
 * 2026-09-14 §3.2).
 *
 *   npm run db:migrate
 *
 * Reads `DATABASE_URL` from the environment (`.env.local` locally; the Vercel
 * project's variables in a deploy). Exits 0 with a note when it is unset, so a
 * build without a database — a fresh clone, a preview without Neon — still
 * succeeds. PGlite never needs this: it migrates itself on first use.
 */
import { createNeonDb, migrateNeon } from "../src/lib/db/neon.ts";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("DATABASE_URL is not set; no migrations to run.");
    return;
  }
  const db = createNeonDb(url);
  await migrateNeon(db);
  console.log("Migrations applied.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
