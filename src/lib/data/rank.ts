import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

/**
 * Ordering a queue by a vocabulary rather than alphabetically (spec §5.6).
 *
 * A status column holds `in_progress` and `open`, and sorting those as text
 * puts closed work above open work. What every queue actually wants is the
 * order the vocabulary constant is *declared* in — `MAINTENANCE_STATUS` and
 * `FEEDBACK_STATUS` both read in the order work moves through them — so this
 * builds `case <column> when 'open' then 0 when 'in_progress' then 1 … end`
 * from the list itself.
 *
 * **Built from the constant, never written out.** Spelling the order by hand is
 * how a value added to a vocabulary ends up sorting silently last for a year,
 * in a query nobody re-reads.
 *
 * Relative imports with `.ts` extensions, no `@/` alias and no `"server-only"`,
 * like every other module under `src/lib/data/`.
 */

/**
 * `column`'s position in `order`, as SQL. Anything not in the list ranks after
 * everything that is — an unrecognised value is not a reason to put a row
 * first.
 *
 * The index is inlined with `sql.raw` because a bare bound integer in a `then`
 * has no type Postgres can infer; the compared value stays a parameter, typed
 * by the column it is compared against.
 */
export function rankByVocabulary(column: SQLWrapper, order: readonly string[]): SQL {
  const whens = order.map((value, index) => sql`when ${value} then ${sql.raw(String(index))}`);
  return sql`case ${column} ${sql.join(whens, sql` `)} else ${sql.raw(String(order.length))} end`;
}
