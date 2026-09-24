import { text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth.ts";

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
 * Who created or last changed a row. `text` referencing Better Auth's
 * `user.id`, which Phase 4 created; Phase 1 deferred the foreign key to that
 * migration because the table it points at did not exist yet.
 *
 * Null on imported rows and on anything the demo seed writes — nobody signed
 * in to create them — so the columns stay nullable and `on delete set null`
 * keeps a row alive when the person who made it is removed. Deleting a user
 * must never delete the catalogue.
 */
export function actorColumns() {
  return {
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
  };
}

/** The legacy Notion page id: the import's upsert key and the `/tools/<id>` redirect key. */
export function notionPageId() {
  return text("notion_page_id").unique();
}

/**
 * `inListCheck` / `inList` live in `./checks.ts` and are re-exported here so
 * every existing import keeps working. They had to move: this module now
 * imports `auth.ts` for the `user.id` reference above, and `auth.ts` needs a
 * CHECK for `user.role` — leaving them here would have made the pair circular.
 */
export { inList, inListCheck } from "./checks.ts";
