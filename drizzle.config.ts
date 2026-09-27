import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit configuration (data platform design spec 2026-09-14 §3.2).
 *
 * `npm run db:generate` diffs `src/lib/db/schema/` against the migrations
 * already in `src/lib/db/migrations/` and writes a new SQL file. Migrations are
 * committed and applied by `npm run db:migrate` (Neon) or on first use (PGlite);
 * nothing runs `push` against a live database.
 *
 * `DATABASE_URL` is only needed for `drizzle-kit studio` / `migrate` — not for
 * `generate`, which is pure computation.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema/index.ts",
  out: "./src/lib/db/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
