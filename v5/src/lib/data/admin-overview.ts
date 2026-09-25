import { sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { rawRows } from "../db/raw.ts";
import type { Db } from "../db/types.ts";
import { listInventoryRows } from "./inventory.ts";
import { countManualsByState } from "./manual-chunks.ts";

/**
 * The `/admin` home's live counts (UI system spec §6.1, data platform spec §6
 * `AdminHome`).
 *
 * One read per tile group, all in parallel, each a `count(*) filter (…)` over
 * one table — the page costs a handful of aggregate statements whatever the
 * size of the lab. The inventory flags are **not** re-derived here: they come
 * from `listInventoryRows`, the same read the review table runs, so a tile can
 * never disagree with the table it links to.
 *
 * `series` are daily counts for the last {@link SERIES_DAYS} days, oldest
 * first, for the tiles' sparklines. Tickets use the day they were reported
 * (imported tickets carry it), everything else the day the row was created.
 */

export const SERIES_DAYS = 30;

export interface AdminOverview {
  inventory: {
    total: number;
    published: number;
    draft: number;
    archived: number;
    needsAttention: number;
    noPhoto: number;
    noManual: number;
    neverReviewed: number;
  };
  intake: { identified: number; researching: number; researched: number; failed: number };
  imports: { ready: number; last30: number };
  refresh: { proposed: number; running: number; failed: number };
  manuals: { searchable: number; total: number };
  maintenance: { open: number; inProgress: number; urgent: number };
  corrections: { open: number };
  projects: { waiting: number; published: number };
  users: { total: number; admins: number; banned: number };
  series: { tickets: number[]; corrections: number[]; intake: number[] };
}

type Num = number | string | null;
const n = (value: Num | undefined) => Number(value ?? 0);

export async function loadAdminOverview(options: { db?: Db } = {}): Promise<AdminOverview> {
  const db = options.db ?? (await getDb());

  const [rows, manuals, [intake], [imports], [refresh], [tickets], [corrections], [projects], [users], series] =
    await Promise.all([
      listInventoryRows({ db }),
      countManualsByState(db),
      rawRows<Record<string, Num>>(
        db,
        sql`select count(*) filter (where status = 'identified') as identified,
                   count(*) filter (where status in ('queued', 'researching')) as researching,
                   count(*) filter (where status = 'researched') as researched,
                   count(*) filter (where status = 'failed') as failed
              from pending_tools`
      ),
      rawRows<Record<string, Num>>(
        db,
        sql`select count(*) filter (where status = 'ready') as ready,
                   count(*) filter (where created_at >= now() - interval '30 days') as last30
              from bulk_imports`
      ),
      rawRows<Record<string, Num>>(
        db,
        sql`select count(*) filter (where status = 'proposed') as proposed,
                   count(*) filter (where status in ('queued', 'researching')) as running,
                   count(*) filter (where status = 'failed') as failed
              from tool_refreshes`
      ),
      rawRows<Record<string, Num>>(
        db,
        sql`select count(*) filter (where status = 'open') as open,
                   count(*) filter (where status = 'in_progress') as in_progress,
                   count(*) filter (where status in ('open', 'in_progress') and priority in ('high', 'critical')) as urgent
              from maintenance_logs`
      ),
      rawRows<Record<string, Num>>(db, sql`select count(*) filter (where status = 'new') as open from feedback`),
      rawRows<Record<string, Num>>(
        db,
        sql`select count(*) filter (where not published) as waiting,
                   count(*) filter (where published) as published
              from projects`
      ),
      rawRows<Record<string, Num>>(
        db,
        sql`select count(*) as total,
                   count(*) filter (where role in ('admin', 'super_admin')) as admins,
                   count(*) filter (where banned) as banned
              from "user"`
      ),
      loadSeries(db),
    ]);

  return {
    inventory: {
      total: rows.length,
      published: rows.filter((row) => row.state === "published").length,
      draft: rows.filter((row) => row.state === "draft").length,
      archived: rows.filter((row) => row.state === "archived").length,
      needsAttention: rows.filter((row) => row.needsAttention).length,
      noPhoto: rows.filter((row) => row.attention.noPhoto).length,
      noManual: rows.filter((row) => row.attention.noManual).length,
      neverReviewed: rows.filter((row) => row.attention.neverReviewed).length,
    },
    intake: {
      identified: n(intake?.identified),
      researching: n(intake?.researching),
      researched: n(intake?.researched),
      failed: n(intake?.failed),
    },
    imports: { ready: n(imports?.ready), last30: n(imports?.last30) },
    refresh: { proposed: n(refresh?.proposed), running: n(refresh?.running), failed: n(refresh?.failed) },
    manuals: {
      searchable: manuals.searchable,
      total: manuals.searchable + manuals.textOnly + manuals.noText + manuals.failed + manuals.processing,
    },
    maintenance: { open: n(tickets?.open), inProgress: n(tickets?.in_progress), urgent: n(tickets?.urgent) },
    corrections: { open: n(corrections?.open) },
    projects: { waiting: n(projects?.waiting), published: n(projects?.published) },
    users: { total: n(users?.total), admins: n(users?.admins), banned: n(users?.banned) },
    series,
  };
}

/** Daily counts, oldest first, zero-filled — one statement per series. */
async function loadSeries(db: Db): Promise<AdminOverview["series"]> {
  const days = SERIES_DAYS;
  const [tickets, corrections, intake] = await Promise.all([
    rawRows<{ age: Num; n: Num }>(
      db,
      sql`select (current_date - coalesce(date_reported, created_at::date)) as age, count(*) as n
            from maintenance_logs
           where coalesce(date_reported, created_at::date) > current_date - ${days}::int
           group by 1`
    ),
    rawRows<{ age: Num; n: Num }>(
      db,
      sql`select (current_date - created_at::date) as age, count(*) as n
            from feedback where created_at::date > current_date - ${days}::int group by 1`
    ),
    rawRows<{ age: Num; n: Num }>(
      db,
      sql`select (current_date - created_at::date) as age, count(*) as n
            from pending_tools where created_at::date > current_date - ${days}::int group by 1`
    ),
  ]);
  return { tickets: fill(tickets, days), corrections: fill(corrections, days), intake: fill(intake, days) };
}

/** Rows of (days ago, count) → an array of `days` counts, oldest first. */
export function fill(rows: ReadonlyArray<{ age: Num; n: Num }>, days: number): number[] {
  const out = new Array<number>(days).fill(0);
  for (const row of rows) {
    const age = n(row.age);
    if (age >= 0 && age < days) out[days - 1 - age] += n(row.n);
  }
  return out;
}
