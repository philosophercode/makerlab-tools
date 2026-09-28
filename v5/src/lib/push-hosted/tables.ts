import { getTableColumns, getTableName, is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import { isExcludedFromBackup, isRetentionBound, redactedColumnKeys } from "../cron/backup-policy.ts";
import * as schema from "../db/schema/index.ts";

/**
 * Which tables `npm run data:push` copies, in what order, and which columns.
 *
 * Derived from the Drizzle schema rather than listed, for the reason the
 * nightly backup gives (`src/lib/cron/backup.ts`): a table added later is
 * copied because it exists, not because somebody remembered. The same policy
 * decides what stays behind — `session`, `verification` and
 * `oauth_access_token` are live sign-ins and never travel; secret columns
 * (`account`'s OAuth tokens, the mirror's Notion token, an OAuth client's
 * secret) are blanked (`src/lib/cron/backup-policy.ts`).
 */

export interface TablePlan {
  /** SQL table name. */
  name: string;
  /** Columns written on insert, in schema order — every column except GENERATED ones. */
  columns: string[];
  /** GENERATED ALWAYS columns: the target computes them, so they are never inserted. */
  generated: string[];
  /** Primary key columns (SQL names), for paging and for the second-pass update. */
  primaryKey: string[];
  /**
   * Foreign-key columns inserted as null and filled in after every table is in
   * (a self-reference, or the edge that breaks a cycle between tables).
   */
  deferred: string[];
  /** SQL names of columns blanked on the way (see `backup-policy.ts`). */
  redacted: string[];
}

export interface CopyPlan {
  /** Tables to copy, parents before children. */
  tables: TablePlan[];
  /** Tables deliberately left behind (live credentials). */
  skipped: string[];
}

/** Every table in the schema (the module also exports vocabulary tuples). */
export function schemaTables(): PgTable[] {
  return (Object.values(schema) as unknown[]).filter((value): value is PgTable => is(value, PgTable));
}

interface Edge {
  from: string;
  to: string;
  columns: string[];
  nullable: boolean;
}

function describe(table: PgTable): { plan: TablePlan; edges: Edge[] } {
  const config = getTableConfig(table);
  const name = config.name;
  const columns = config.columns.filter((c) => !c.generated && !c.generatedIdentity).map((c) => c.name);
  const generated = config.columns.filter((c) => c.generated || c.generatedIdentity).map((c) => c.name);
  const primaryKey = config.columns.filter((c) => c.primary).map((c) => c.name);
  for (const pk of config.primaryKeys) primaryKey.push(...pk.columns.map((c) => c.name));

  const byKey = getTableColumns(table) as Record<string, { name: string }>;
  const redacted = redactedColumnKeys(name).map((key) => {
    const column = byKey[key];
    if (!column) throw new Error(`Redacted column ${name}.${key} is not in the schema.`);
    return column.name;
  });

  const edges = config.foreignKeys.map((fk) => {
    const ref = fk.reference();
    return {
      from: name,
      to: getTableName(ref.foreignTable),
      columns: ref.columns.map((c) => c.name),
      nullable: ref.columns.every((c) => !c.notNull),
    };
  });

  return { plan: { name, columns, generated, primaryKey, deferred: [], redacted }, edges };
}

/**
 * Order `tables` so every foreign key points at a table already inserted.
 *
 * A self-reference (`pending_tools.duplicate_of_pending_id`) is deferred: the
 * rows go in with that column null and a second pass fills it. A cycle between
 * tables is broken the same way, on a nullable edge; a cycle made only of NOT
 * NULL columns cannot be copied row by row and throws.
 */
export function planTables(tables: PgTable[] = schemaTables()): CopyPlan {
  const skipped: string[] = [];
  const plans = new Map<string, TablePlan>();
  const edges: Edge[] = [];
  for (const table of tables) {
    if (isExcludedFromBackup(table) || isRetentionBound(table)) {
      skipped.push(getTableName(table));
      continue;
    }
    const described = describe(table);
    plans.set(described.plan.name, described.plan);
    edges.push(...described.edges);
  }

  // Edges into a skipped table do not constrain order (nothing is inserted there).
  const live: Edge[] = [];
  for (const edge of edges) {
    if (!plans.has(edge.to)) continue;
    if (edge.from === edge.to) {
      defer(plans.get(edge.from)!, edge);
      continue;
    }
    live.push(edge);
  }

  const ordered: TablePlan[] = [];
  const remaining = new Set([...plans.keys()].sort());
  let pending = live;
  while (remaining.size > 0) {
    const ready = [...remaining].filter((name) => !pending.some((e) => e.from === name && remaining.has(e.to)));
    if (ready.length > 0) {
      for (const name of ready) {
        ordered.push(plans.get(name)!);
        remaining.delete(name);
      }
      continue;
    }
    // A cycle: defer one nullable edge inside it and try again.
    const breakable = pending
      .filter((e) => remaining.has(e.from) && remaining.has(e.to) && e.nullable)
      .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))[0];
    if (!breakable) {
      throw new Error(`Cannot order tables with a NOT NULL foreign-key cycle among: ${[...remaining].join(", ")}`);
    }
    defer(plans.get(breakable.from)!, breakable);
    pending = pending.filter((e) => e !== breakable);
  }

  return { tables: ordered, skipped: skipped.sort() };
}

function defer(plan: TablePlan, edge: Edge): void {
  if (!edge.nullable) {
    throw new Error(`${plan.name}.${edge.columns.join(",")} references ${edge.to} but is NOT NULL, so it cannot be deferred.`);
  }
  if (plan.primaryKey.length === 0) {
    throw new Error(`${plan.name} has a deferred foreign key but no primary key to update it by.`);
  }
  for (const column of edge.columns) if (!plan.deferred.includes(column)) plan.deferred.push(column);
}
