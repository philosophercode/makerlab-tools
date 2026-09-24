import { getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { account, session, verification } from "../db/schema/auth";

/**
 * What the nightly export deliberately leaves out (data platform design spec
 * §3.9, and the Phase 3 note that asked whoever landed Better Auth's tables to
 * decide this).
 *
 * `backup.ts` discovers its tables rather than listing them, which is what a
 * backup should do: a table added in a later phase is exported because it
 * exists, not because somebody remembered. But Phase 4 added tables whose rows
 * are *live credentials*, and a `select *` over them writes bearer tokens into
 * a file that is then kept for thirty days. A restorable copy of the catalogue
 * is worth having; a thirty-day archive of session tokens is a way for anyone
 * holding one backup to sign in as anybody.
 *
 * So the default stays "back it up", and the exceptions are named here:
 *
 *  - **`session` and `verification` are skipped whole.** A session row *is* a
 *    bearer token, and a verification row is a half-finished OAuth handshake
 *    that is meaningless minutes later. Neither is worth restoring — and
 *    restoring them would mean reviving sign-ins that should have ended with
 *    whatever outage forced the restore.
 *  - **`account` is kept, with its secret columns blanked.** The row that
 *    matters is the link — this person is this Google `sub` — which is exactly
 *    what a restore needs to put somebody back together. The tokens are
 *    Google's and are reissued on the next sign-in, so losing them costs
 *    nothing and keeping them costs a credential in a file.
 *  - **`user` is kept whole, deliberately.** `role` and `banned` are the state
 *    a restore would most need to get right, and the row carries no secret.
 *
 * Everything is named through the table objects rather than string literals, so
 * renaming a table or a column fails the typecheck here instead of quietly
 * un-redacting it.
 */

/**
 * `account` columns blanked in the export. Typed against the table's own row
 * shape: rename `refreshToken` and this list stops compiling.
 */
const ACCOUNT_SECRETS = [
  "accessToken",
  "refreshToken",
  "idToken",
  "password",
] as const satisfies readonly (keyof typeof account.$inferSelect)[];

/** Tables the nightly file does not contain at all. */
export const EXCLUDED_TABLES: ReadonlySet<string> = new Set([
  getTableName(session),
  getTableName(verification),
]);

/** Per-table column blanklists, by SQL table name. */
const REDACTED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  [getTableName(account)]: ACCOUNT_SECRETS,
};

/** True when this table's rows must not be written to a backup file at all. */
export function isExcludedFromBackup(table: PgTable): boolean {
  return EXCLUDED_TABLES.has(getTableName(table));
}

/**
 * A copy of `rows` with this table's secret columns set to null.
 *
 * Null rather than absent: the column still exists and is nullable, so the
 * exported row stays the right shape for a restore to insert. A missing key
 * would read as "this backup predates the column", which is a different and
 * more confusing thing to hand somebody at 3am.
 */
export function redactRows(tableName: string, rows: unknown[]): unknown[] {
  const secrets = REDACTED_COLUMNS[tableName];
  if (!secrets) return rows;
  return rows.map((row) => {
    const copy = { ...(row as Record<string, unknown>) };
    for (const key of secrets) {
      if (key in copy) copy[key] = null;
    }
    return copy;
  });
}
