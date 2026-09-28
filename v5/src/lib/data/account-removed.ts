import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/**
 * True, in SQL, when `column` names an account that no longer exists (auth spec
 * amendment 2026-09-25, "Remove a person").
 *
 * For the queues whose reporter or author id — `maintenance_logs.
 * reported_by_user_id`, `feedback.reporter_user_id`, `projects.author_user_id`
 * — is **not** a foreign key, so it keeps the old id after the account is
 * removed. An id that names no account is what "removed" means there, and the
 * page says "(removed)" beside the name it already has. Null — an anonymous or
 * imported row — is never "removed".
 *
 * Its own module so a queue read does not import the removal transaction.
 */
export function accountRemoved(column: AnyPgColumn): SQL<boolean> {
  return sql<boolean>`(${column} is not null and not exists (select 1 from "user" as removed_check where removed_check.id = ${column}))`;
}
