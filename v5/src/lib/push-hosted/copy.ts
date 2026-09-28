import { mentionsForeignStore, mentionsLocalStore, transformRow, type Rewrites, type Row } from "./rows.ts";
import { ident, type SqlClient } from "./sql.ts";
import type { CopyPlan, TablePlan } from "./tables.ts";

/**
 * Moving rows: count them, and copy every planned table from one database to
 * another inside one transaction on the target.
 *
 * Rows are read as `to_jsonb(t)` and written back with
 * `jsonb_populate_recordset`, so every value makes the trip as Postgres's own
 * text form: ids, microsecond timestamps, jsonb, arrays, pgvector embeddings.
 */

/** Row counts per table; null when the table does not exist there. */
export async function countRows(client: SqlClient, tables: string[]): Promise<Map<string, number | null>> {
  const counts = new Map<string, number | null>();
  for (const name of tables) {
    const [found] = await client.query<{ t: string | null }>("select to_regclass($1)::text as t", [ident(name)]);
    if (!found?.t) {
      counts.set(name, null);
      continue;
    }
    const [row] = await client.query<{ n: number }>(`select count(*)::int as n from ${ident(name)}`);
    counts.set(name, Number(row?.n ?? 0));
  }
  return counts;
}

/** Every row of one table, read a page at a time in primary-key order. */
export async function* readTable(client: SqlClient, plan: TablePlan, pageSize = 500): AsyncGenerator<Row[]> {
  const order = plan.primaryKey.length > 0 ? plan.primaryKey.map((c) => `t.${ident(c)}`).join(", ") : "t.ctid";
  for (let offset = 0; ; offset += pageSize) {
    const rows = await client.query<{ r: Row }>(
      `select to_jsonb(t) as r from ${ident(plan.name)} t order by ${order} limit ${pageSize} offset ${offset}`
    );
    if (rows.length === 0) return;
    yield rows.map((row) => row.r);
    if (rows.length < pageSize) return;
  }
}

/** `insert … select … from jsonb_populate_recordset`, generated columns left to the target. */
export function insertSql(plan: TablePlan): string {
  const columns = plan.columns.map(ident).join(", ");
  return (
    `insert into ${ident(plan.name)} (${columns}) ` +
    `select ${columns} from jsonb_populate_recordset(null::${ident(plan.name)}, $1::jsonb)`
  );
}

/** The second pass: restore deferred foreign keys by primary key. */
export function deferredUpdateSql(plan: TablePlan): string {
  const set = plan.deferred.map((c) => `${ident(c)} = s.${ident(c)}`).join(", ");
  const match = plan.primaryKey.map((c) => `t.${ident(c)} = s.${ident(c)}`).join(" and ");
  return (
    `update ${ident(plan.name)} as t set ${set} ` +
    `from jsonb_populate_recordset(null::${ident(plan.name)}, $1::jsonb) as s where ${match}`
  );
}

export interface CopyLimits {
  /** Rows read per source page. */
  pageSize?: number;
  /** Rows per insert statement. */
  batchRows?: number;
  /** Approximate JSON bytes per insert statement. */
  batchBytes?: number;
  /** The target's Blob store hosts: a row still naming another store is counted in `stillForeign`. */
  targetHosts?: readonly string[];
}

export interface CopyResult {
  rows: Map<string, number>;
  /** Deferred foreign-key values restored in the second pass. */
  relinked: number;
  /** Rows that still mention `/api/dev-blob/` after rewriting, per table. */
  stillLocal: Map<string, number>;
  /** Rows that still name a Blob store that is not the target's after rewriting, per table. */
  stillForeign: Map<string, number>;
}

/**
 * Replace the target's rows with the source's, all in one transaction: any
 * failure rolls the target back to exactly what it held.
 *
 * `TRUNCATE … CASCADE` also empties tables that reference the copied ones
 * and are not copied themselves — the target's `session` rows (every hosted
 * sign-in ends) and `oauth_access_token` rows.
 */
export async function copyTables(
  source: SqlClient,
  target: SqlClient,
  plan: CopyPlan,
  rewrites: Rewrites,
  limits: CopyLimits = {},
  onTable: (name: string, rows: number) => void = () => {}
): Promise<CopyResult> {
  const batchRows = limits.batchRows ?? 500;
  const batchBytes = limits.batchBytes ?? 2_000_000;
  const result: CopyResult = { rows: new Map(), relinked: 0, stillLocal: new Map(), stillForeign: new Map() };
  const targetHosts = limits.targetHosts ?? [];
  const deferred = new Map<TablePlan, Row[]>();

  await target.query("begin");
  try {
    await target.query(`truncate ${plan.tables.map((t) => ident(t.name)).join(", ")} cascade`);

    for (const table of plan.tables) {
      const sql = insertSql(table);
      let batch: string[] = [];
      let bytes = 0;
      let count = 0;
      const flush = async () => {
        if (batch.length === 0) return;
        await target.query(sql, [`[${batch.join(",")}]`]);
        batch = [];
        bytes = 0;
      };

      for await (const page of readTable(source, table, limits.pageSize)) {
        for (const sourceRow of page) {
          const { row, deferred: later } = transformRow(table, sourceRow, rewrites);
          if (later) {
            if (!deferred.has(table)) deferred.set(table, []);
            deferred.get(table)!.push(later);
          }
          if (mentionsLocalStore(row)) result.stillLocal.set(table.name, (result.stillLocal.get(table.name) ?? 0) + 1);
          if (mentionsForeignStore(row, targetHosts)) {
            result.stillForeign.set(table.name, (result.stillForeign.get(table.name) ?? 0) + 1);
          }
          const json = JSON.stringify(row);
          batch.push(json);
          bytes += json.length;
          count += 1;
          if (batch.length >= batchRows || bytes >= batchBytes) await flush();
        }
      }
      await flush();
      result.rows.set(table.name, count);
      onTable(table.name, count);
    }

    // The `updated_at` triggers would stamp every relinked row with now();
    // switching user triggers off for the update keeps the copied timestamps.
    // Foreign-key checks are system triggers and stay on.
    for (const [table, rows] of deferred) {
      await target.query(`alter table ${ident(table.name)} disable trigger user`);
      for (let i = 0; i < rows.length; i += batchRows) {
        await target.query(deferredUpdateSql(table), [JSON.stringify(rows.slice(i, i + batchRows))]);
      }
      await target.query(`alter table ${ident(table.name)} enable trigger user`);
      result.relinked += rows.length;
    }

    await resetSequences(target, plan);
    await target.query("commit");
  } catch (error) {
    await target.query("rollback").catch(() => {});
    throw error;
  }
  return result;
}

/**
 * Serial and identity columns (none today) would otherwise hand out ids the
 * copy already used.
 */
async function resetSequences(target: SqlClient, plan: CopyPlan): Promise<void> {
  const copied = new Set(plan.tables.map((t) => t.name));
  const sequences = await target.query<{ table_name: string; column_name: string; seq: string | null }>(
    `select table_name, column_name, pg_get_serial_sequence(format('%I', table_name), column_name) as seq
       from information_schema.columns
      where table_schema = 'public' and (column_default like 'nextval(%' or is_identity = 'YES')`
  );
  for (const { table_name, column_name, seq } of sequences) {
    if (!seq || !copied.has(table_name)) continue;
    await target.query(
      `select setval($1, coalesce((select max(${ident(column_name)}) from ${ident(table_name)}), 0) + 1, false)`,
      [seq]
    );
  }
}
