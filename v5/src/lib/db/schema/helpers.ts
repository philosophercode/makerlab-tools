import { sql, type SQL } from "drizzle-orm";
import { check, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Column and constraint helpers shared by every table in `schema/`.
 *
 * Imports inside `src/lib/db/` use explicit relative paths with `.ts`
 * extensions and no `@/` alias, because the import and migrate scripts load
 * these modules under plain Node (`--experimental-strip-types`) as well as
 * under Next.
 */

/**
 * `created_at` / `updated_at` on every mutable table (spec §4). `updated_at`
 * is maintained by a `BEFORE UPDATE` trigger (migration `0002`), not by the
 * ORM, because the import, the demo seed and any manual SQL fix write outside
 * Drizzle, and the Notion mirror selects on this column.
 */
export function timestamps() {
  return {
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  };
}

/**
 * Who created or last changed a row. Plain `text` for now: it will reference
 * Better Auth's `user.id` once Phase 4 creates that table, and the foreign key
 * is added in that phase's migration. Null on imported rows.
 */
export function actorColumns() {
  return {
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
  };
}

/** The legacy Notion page id: the import's upsert key and the `/tools/<id>` redirect key. */
export function notionPageId() {
  return text("notion_page_id").unique();
}

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
