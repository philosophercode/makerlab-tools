import { sql, type SQL } from "drizzle-orm";
import { check } from "drizzle-orm/pg-core";

/**
 * Named CHECK constraints over a stored vocabulary (spec §4).
 *
 * These live apart from `helpers.ts` for one structural reason: from Phase 4
 * `helpers.ts` imports `auth.ts` (so `created_by` can reference `user.id`) and
 * `auth.ts` needs a CHECK for `user.role`. Keeping the check builders in a leaf
 * module nothing else imports keeps `helpers → auth` acyclic instead of relying
 * on ESM's tolerance for a cycle. `helpers.ts` re-exports both names, so every
 * existing `import { inListCheck } from "./helpers.ts"` still resolves.
 */

/**
 * A named CHECK that restricts `column` to `values`. Written with `sql.raw` so
 * drizzle-kit renders the literals into the migration instead of `$1`
 * placeholders.
 */
export function inListCheck(
  name: string,
  column: string,
  values: readonly string[]
): ReturnType<typeof check> {
  return check(name, inList(column, values));
}

/** `"column" in ('a', 'b', …)` as raw SQL; a null column value passes the CHECK. */
export function inList(column: string, values: readonly string[]): SQL {
  const literals = values.map((value) => `'${value.replace(/'/g, "''")}'`).join(", ");
  return sql.raw(`"${column}" in (${literals})`);
}
