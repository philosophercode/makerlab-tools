import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import * as schema from "./schema/index.ts";
import { migrationsFolder } from "./migrations-folder.ts";
import type { Db } from "./types.ts";

/**
 * Neon Postgres over the serverless driver (spec §3.2). The pooled
 * (WebSocket) client rather than the HTTP one, because approvals and imports
 * need transactions.
 *
 * The driver needs a global `WebSocket`, which Node 22+ and every Vercel
 * runtime provide. The check below turns a missing one into a plain sentence
 * instead of a stack trace from inside the driver.
 */
export function createNeonDb(connectionString: string): Db {
  if (typeof WebSocket === "undefined") {
    throw new Error("The Neon driver needs a global WebSocket; run on Node 22 or newer.");
  }
  const pool = new Pool({ connectionString });
  return drizzle(pool, { schema });
}

/** Apply every committed migration that has not run yet. Used by `db:migrate`. */
export async function migrateNeon(db: Db): Promise<void> {
  await migrate(db as Parameters<typeof migrate>[0], { migrationsFolder: migrationsFolder() });
}
