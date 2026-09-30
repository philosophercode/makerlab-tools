import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SqlClient } from "./sql.ts";

/**
 * The schema check before anything is copied. `data:push` does not migrate the
 * hosted database — the app's build does (`npm run build` runs `db:migrate`) —
 * so it only confirms that the checked-out code, the local database and the
 * hosted one all stand at the same migration, and refuses otherwise.
 *
 * Drizzle records each applied migration in `drizzle.__drizzle_migrations`
 * with `created_at` = the journal's `when` for that migration.
 */

export interface MigrationState {
  /** The latest applied migration's `created_at` (the journal's `when`), or null when none. */
  latest: string | null;
  count: number;
}

export async function readMigrationState(client: SqlClient): Promise<MigrationState> {
  const [exists] = await client.query<{ t: string | null }>(
    "select to_regclass('drizzle.__drizzle_migrations')::text as t"
  );
  if (!exists?.t) return { latest: null, count: 0 };
  const [row] = await client.query<{ latest: string | null; count: number }>(
    "select max(created_at)::text as latest, count(*)::int as count from drizzle.__drizzle_migrations"
  );
  return { latest: row?.latest ?? null, count: Number(row?.count ?? 0) };
}

export interface RepoMigration {
  when: string;
  tag: string;
}

/** The last migration committed in `folder` (its `meta/_journal.json`). */
export function latestRepoMigration(folder: string): RepoMigration | null {
  const journal = JSON.parse(readFileSync(join(folder, "meta/_journal.json"), "utf8")) as {
    entries: { when: number; tag: string }[];
  };
  const last = journal.entries.at(-1);
  return last ? { when: String(last.when), tag: last.tag } : null;
}

/**
 * Null when all three agree; otherwise one sentence saying which is behind and
 * what to run.
 */
export function migrationMismatch(
  repo: RepoMigration | null,
  local: MigrationState,
  target: MigrationState
): string | null {
  if (!local.latest) {
    return "The local database has no migrations recorded. Start the dev server once (or run `npm run db:migrate` with PGLITE_DATA_DIR set).";
  }
  if (!target.latest) {
    return "The hosted database has not been migrated. Redeploy the project on Vercel (its build runs `db:migrate`), then try again.";
  }
  if (repo && local.latest !== repo.when) {
    return (
      `The local database (${local.count} migrations) is not at this checkout's latest migration (${repo.tag}). ` +
      "Run `npm run db:migrate` with PGLITE_DATA_DIR set, or check out the code that matches it."
    );
  }
  if (local.latest !== target.latest) {
    const behind = Number(target.latest) < Number(local.latest) ? "behind" : "ahead of";
    return (
      `The hosted database (${target.count} migrations) is ${behind} the local one (${local.count}). ` +
      "Deploy the same commit you have checked out (its build migrates the hosted database), " +
      "or bring the local database up to date, then try again."
    );
  }
  return null;
}
