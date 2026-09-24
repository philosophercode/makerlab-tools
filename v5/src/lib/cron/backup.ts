import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import type { BlobStore } from "../blob";
import { getDb } from "../db/client";
import * as schema from "../db/schema/index";
import type { Db } from "../db/types";
import { isExcludedFromBackup, redactRows } from "./backup-policy";

/**
 * The nightly export (data platform design spec §3.9).
 *
 * This replaces the Notion dump that `GET /api/admin/backup` wrote. The reason
 * for it has not changed: before it existed there was **no backup at all**, and
 * one deleted database took ~100 machines of accumulated staff work with it.
 * What changed is where the data lives — the source of truth is Postgres now
 * (Article 7), so the file is a row-level export of every table rather than a
 * pile of raw Notion pages.
 *
 * **It never swallows a failure.** A backup that fails quietly is worse than no
 * backup, because you find out on the day you need it. Every error here throws
 * so the route can answer non-200 and the invocation shows up as failed in
 * Vercel's cron log.
 *
 * **The dump is PII.** `maintenance_logs` carries student names and reporter
 * email addresses and `feedback` carries reporter emails, so the file goes to
 * *private* blob storage (`blob.ts`'s `put` cannot write any other kind) and
 * belongs in whatever data inventory the university keeps. It is PII and not
 * credentials: `backup-policy.ts` holds back the tables and columns that would
 * let a reader of one backup sign in as somebody.
 */

export const BACKUP_PREFIX = "backups/";
const BACKUP_PATHNAME = /^backups\/(\d{4}-\d{2}-\d{2})\.json$/;
export const RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Serialized file format. `version` is here so a future reader can tell what it has. */
export interface BackupFile {
  version: 2;
  /** `notion` was version 1's; a restore has to know which shape it holds. */
  source: "postgres";
  createdAt: string;
  tables: Record<string, { rowCount: number; rows: unknown[] }>;
}

export interface BackupResult {
  pathname: string;
  bytes: number;
  retentionDays: number;
  tables: Record<string, number>;
  pruned: string[];
}

export interface BackupOptions {
  /** A handle to use instead of {@link getDb} — tests pass an isolated one. */
  db?: Db;
  /** Clock injection, so a test can stage retention without waiting 30 days. */
  now?: Date;
}

/**
 * Every table in the schema, discovered rather than listed — minus the few
 * `backup-policy.ts` names as credentials rather than data.
 *
 * Discovery is deliberate: the old route derived its targets from `notion.ts`'s
 * env contract for exactly this reason. When Phase 6 adds `pending_tools` it is
 * backed up because it exists, not because somebody remembered to add it here —
 * which is precisely the class of failure a backup exists to prevent.
 *
 * The exclusions are the other half of that bargain. Phase 4 landed Better
 * Auth's tables, and `session` rows are bearer tokens; discovery would have
 * archived thirty days of live sign-ins without anyone choosing to. The policy
 * module says which tables and columns are held back, and why.
 */
export function backupTables(): PgTable[] {
  // `schema` also exports the vocabulary tuples, so the cast to `unknown[]`
  // is what lets the `is(...)` guard do the narrowing rather than TypeScript
  // trying to union every table's exact shape.
  return (Object.values(schema) as unknown[])
    .filter((value): value is PgTable => is(value, PgTable))
    .filter((table) => !isExcludedFromBackup(table))
    .sort((a, b) => getTableName(a).localeCompare(getTableName(b)));
}

/**
 * Read every table and write one JSON file to private Blob, then prune anything
 * past the retention window.
 *
 * Reads are sequential: this runs once a day over a few thousand rows, and a
 * fan-out would only buy contention on one Neon connection.
 */
export async function runBackup(
  store: BlobStore,
  options: BackupOptions = {}
): Promise<BackupResult> {
  const db = options.db ?? (await getDb());
  const now = options.now ?? new Date();

  const file: BackupFile = {
    version: 2,
    source: "postgres",
    createdAt: now.toISOString(),
    tables: {},
  };

  for (const table of backupTables()) {
    const name = getTableName(table);
    // No projection and no filter: a backup exists to restore what the database
    // held, not what the site showed. A `select *` is the point here — and then
    // `redactRows` blanks the handful of columns that are credentials rather
    // than records (see `backup-policy.ts`). `rowCount` is the true count
    // either way; redaction empties fields, it never drops a row.
    const rows = redactRows(name, await db.select().from(table));
    file.tables[name] = { rowCount: rows.length, rows };
  }

  const pathname = `${BACKUP_PREFIX}${isoDate(now)}.json`;
  const body = JSON.stringify(file);
  await store.put(pathname, body, "application/json");

  // Retention runs in the same job so nobody has to remember it.
  const existing = await store.list(BACKUP_PREFIX);
  const pruned = expiredBackups(
    existing.map((blob) => blob.pathname),
    now
  );
  await store.del(pruned);

  return {
    pathname,
    bytes: byteLength(body),
    retentionDays: RETENTION_DAYS,
    tables: Object.fromEntries(
      Object.entries(file.tables).map(([name, entry]) => [name, entry.rowCount])
    ),
    pruned,
  };
}

/**
 * Backups older than the retention window, by the date in their own filename.
 * Anything that does not match the pattern is left alone — a prune step that
 * deletes files it does not recognise is a hazard, not a housekeeper.
 */
export function expiredBackups(pathnames: string[], now: Date): string[] {
  return pathnames.filter((pathname) => {
    const match = BACKUP_PATHNAME.exec(pathname);
    if (!match) return false;
    const stamped = Date.parse(`${match[1]}T00:00:00.000Z`);
    if (Number.isNaN(stamped)) return false;
    return (now.getTime() - stamped) / DAY_MS >= RETENTION_DAYS;
  });
}

/**
 * UTC, not `LAB_TIMEZONE`: this names a *file*, and the retention window that
 * reads the name back counts UTC days. Ticket dates are the lab's; an ops
 * artifact's is the machine's.
 */
function isoDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Byte length, so the reported size is the file's rather than the string's. */
function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
