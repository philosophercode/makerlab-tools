import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * The optimistic-concurrency token the tool editor carries (spec §5.3(4)).
 *
 * Two people can have the same tool open. The panel reads a token when it
 * opens and hands it back with the save; the save writes only if the row still
 * carries that token, and otherwise writes *nothing* and says somebody else
 * changed this tool. `updated_at` is the natural token — the `set_updated_at()`
 * BEFORE UPDATE trigger (migration `0002`) moves it on every write, including a
 * write that changes no field.
 *
 * **The token is a string, and that is the whole point of this module.** The
 * obvious version — read `updated_at` back as a `Date` and compare
 * `where updated_at = <that Date>` — is green in every test here and broken in
 * production:
 *
 * - Postgres `now()` is **microsecond**-resolution, so a real `updated_at` is
 *   `…:32.718493+00`.
 * - Both drivers parse `timestamptz` into a JavaScript `Date`, which holds
 *   **milliseconds**. The token the panel received is already `…:32.718`.
 * - Sending that back matches **zero rows**, so every save on Neon would report
 *   a conflict that did not happen, and the editor would be unusable.
 * - PGlite's `now()` is millisecond-resolution, so the round trip is lossless
 *   there and the naive check passes locally forever.
 *
 * A test-green, production-broken comparison is the worst kind, so the value
 * never becomes a `Date` at all: `extract(epoch from …)::text` is computed by
 * Postgres and compared by Postgres, and the string only ever travels through
 * JavaScript. `revision.test.ts` stages a microsecond `updated_at` with the
 * trigger disabled and pins both halves.
 *
 * **One expression, used twice.** {@link revisionEquals} is built out of
 * {@link revisionOf}, so a token cannot be minted by one spelling and compared
 * with another — the failure mode that would put the bug back.
 *
 * Relative imports with `.ts` extensions, no `@/` alias and no `"server-only"`,
 * like every other module under `src/lib/data/`.
 */

/**
 * A row's revision: opaque to everything above the data layer. Callers pass it
 * around and hand it back; nobody parses it, orders it, or renders it.
 */
export type Revision = string;

/**
 * The token for one `timestamptz` column, as Postgres computes it.
 *
 * Used in the `returning` of a write as well as in its `where`, so a caller
 * that saves twice in a row never has to re-read to get the next token.
 */
export function revisionOf(column: PgColumn): SQL<Revision> {
  return sql<Revision>`extract(epoch from ${column})::text`;
}

/**
 * "This row is still at the revision the caller saw." Nested rather than
 * re-spelled so the two sides cannot drift.
 *
 * At millisecond resolution — PGlite, and only PGlite — two writes inside the
 * same millisecond produce the same token, so a conflict between them would go
 * undetected. Real Postgres has a thousand times the resolution and no such
 * window, and the alternative (a version counter column) is a migration on
 * every table for a race that only the demo substrate can have.
 */
export function revisionEquals(column: PgColumn, expected: Revision): SQL<unknown> {
  return sql`${revisionOf(column)} = ${expected}`;
}
