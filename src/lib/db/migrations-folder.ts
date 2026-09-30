import { resolve } from "node:path";

/**
 * Where the committed SQL migrations live. Resolved from the working
 * directory because every entry point — `next dev`, Vitest, Playwright's dev
 * server, and the `db:migrate` / `import:notion` scripts — runs from the repo root.
 * `DB_MIGRATIONS_DIR` overrides it for anything that does not.
 */
export function migrationsFolder(): string {
  return process.env.DB_MIGRATIONS_DIR || resolve(process.cwd(), "src/lib/db/migrations");
}
