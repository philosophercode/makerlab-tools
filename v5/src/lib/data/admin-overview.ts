import { sql } from "drizzle-orm";
import type { CountLoader } from "../admin/surfaces.ts";
import { getDb } from "../db/client.ts";
import { rawRows } from "../db/raw.ts";
import type { Db } from "../db/types.ts";
import { listInventoryRows } from "./inventory.ts";
import { countManualsByState } from "./manual-chunks.ts";
import { getMirrorViewForOwner } from "./mirrors.ts";

/**
 * The `/admin` home's live counts (UI system spec §8.1; data platform spec §6
 * `AdminHome`), one **count loader** per tile, named by the surface's `count`
 * in `lib/admin/surfaces.ts`.
 *
 * **Only what the viewer's tiles show is read.** The page asks for the loaders
 * of the surfaces the viewer may open, so a SuperMaker's home never counts the
 * people table it will not show. Each loader is one aggregate statement
 * (`count(*) filter (…)` over one table, plus a 30-day series where a trend
 * matters), and they run in parallel.
 *
 * **A loader that fails is `null`, never zero.** Every loader settles on its
 * own, so one unreadable table costs one tile its number ("Could not be read")
 * and the rest of the home still answers "where is the work" (Article 4). A
 * zero is a count that came back zero.
 *
 * The inventory counts are **not** re-derived: they come from
 * `listInventoryRows`, the read the review table runs, so the tile can never
 * disagree with the table it links to. `series` are daily counts for the last
 * {@link SERIES_DAYS} days, oldest first: tickets by the day they were reported
 * (imported tickets carry it), everything else by the day the row was created.
 */

export const SERIES_DAYS = 30;

export interface OverviewCounts {
  intake: { identified: number; researching: number; researched: number; failed: number; series: number[] };
  imports: { ready: number; mapping: number; last30: number };
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
  refresh: { proposed: number; running: number; failed: number };
  manuals: { searchable: number; total: number; failed: number };
  maintenance: { open: number; inProgress: number; urgent: number; series: number[] };
  corrections: { open: number; handled: number; series: number[] };
  projects: { waiting: number; published: number };
  users: { total: number; admins: number; banned: number };
  mirror: { state: "notConnected" | "connected" | "paused" | "failed" };
}

/**
 * What the home received: a loader's counts, `null` when it failed, and no key
 * at all when it was not asked for.
 */
export type AdminOverview = { [K in CountLoader]?: OverviewCounts[K] | null };

export interface OverviewContext {
  db: Db;
  /** The viewer — the mirror tile is their own mirror, found by owner (§8). */
  userId: string | null;
}

type Num = number | string | null;
const n = (value: Num | undefined) => Number(value ?? 0);

/** Each surface's count loader. */
export const COUNT_LOADER_READS: { [K in CountLoader]: (ctx: OverviewContext) => Promise<OverviewCounts[K]> } = {
  async intake({ db }) {
    const [[row], series] = await Promise.all([
      // An imported row not yet sent to research is reviewed on its import's
      // page, not in the queue (bulk intake spec §5) — so it is not counted as
      // the queue's, and the tile agrees with the page it opens.
      rawRows<Record<string, Num>>(
        db,
        sql`select count(*) filter (where status = 'identified' and import_id is null) as identified,
                   count(*) filter (where status in ('queued', 'researching')) as researching,
                   count(*) filter (where status = 'researched') as researched,
                   count(*) filter (where status = 'failed') as failed
              from pending_tools`
      ),
      dailySeries(db, sql`created_at::date`, sql`pending_tools`),
    ]);
    return {
      identified: n(row?.identified),
      researching: n(row?.researching),
      researched: n(row?.researched),
      failed: n(row?.failed),
      series,
    };
  },

  async imports({ db }) {
    const [row] = await rawRows<Record<string, Num>>(
      db,
      sql`select count(*) filter (where status = 'ready') as ready,
                 count(*) filter (where status = 'mapping') as mapping,
                 count(*) filter (where created_at >= now() - interval '30 days') as last30
            from bulk_imports`
    );
    return { ready: n(row?.ready), mapping: n(row?.mapping), last30: n(row?.last30) };
  },

  async inventory({ db }) {
    const rows = await listInventoryRows({ db });
    const count = (test: (row: (typeof rows)[number]) => boolean) => rows.reduce((sum, row) => (test(row) ? sum + 1 : sum), 0);
    return {
      total: rows.length,
      published: count((row) => row.state === "published"),
      draft: count((row) => row.state === "draft"),
      archived: count((row) => row.state === "archived"),
      needsAttention: count((row) => row.needsAttention),
      noPhoto: count((row) => row.attention.noPhoto),
      noManual: count((row) => row.attention.noManual),
      neverReviewed: count((row) => row.attention.neverReviewed),
    };
  },

  async refresh({ db }) {
    const [row] = await rawRows<Record<string, Num>>(
      db,
      sql`select count(*) filter (where status = 'proposed') as proposed,
                 count(*) filter (where status in ('queued', 'researching')) as running,
                 count(*) filter (where status = 'failed') as failed
            from tool_refreshes`
    );
    return { proposed: n(row?.proposed), running: n(row?.running), failed: n(row?.failed) };
  },

  async manuals({ db }) {
    const counts = await countManualsByState(db);
    return {
      searchable: counts.searchable,
      total: counts.searchable + counts.textOnly + counts.noText + counts.failed + counts.processing,
      failed: counts.failed,
    };
  },

  async maintenance({ db }) {
    const [[row], series] = await Promise.all([
      rawRows<Record<string, Num>>(
        db,
        sql`select count(*) filter (where status = 'open') as open,
                   count(*) filter (where status = 'in_progress') as in_progress,
                   count(*) filter (where status in ('open', 'in_progress') and priority in ('high', 'critical')) as urgent
              from maintenance_logs`
      ),
      dailySeries(db, sql`coalesce(date_reported, created_at::date)`, sql`maintenance_logs`),
    ]);
    return { open: n(row?.open), inProgress: n(row?.in_progress), urgent: n(row?.urgent), series };
  },

  async corrections({ db }) {
    const [[row], series] = await Promise.all([
      rawRows<Record<string, Num>>(
        db,
        sql`select count(*) filter (where status = 'new') as open,
                   count(*) filter (where status <> 'new') as handled
              from feedback`
      ),
      dailySeries(db, sql`created_at::date`, sql`feedback`),
    ]);
    return { open: n(row?.open), handled: n(row?.handled), series };
  },

  async projects({ db }) {
    const [row] = await rawRows<Record<string, Num>>(
      db,
      sql`select count(*) filter (where not published) as waiting,
                 count(*) filter (where published) as published
            from projects`
    );
    return { waiting: n(row?.waiting), published: n(row?.published) };
  },

  async users({ db }) {
    const [row] = await rawRows<Record<string, Num>>(
      db,
      sql`select count(*) as total,
                 count(*) filter (where role in ('admin', 'super_admin')) as admins,
                 count(*) filter (where banned) as banned
            from "user"`
    );
    return { total: n(row?.total), admins: n(row?.admins), banned: n(row?.banned) };
  },

  async mirror({ db, userId }) {
    const view = userId ? await getMirrorViewForOwner(userId, { db }) : null;
    const state = !view?.connected
      ? "notConnected"
      : view.paused
        ? "paused"
        : view.lastStatus === "failed"
          ? "failed"
          : "connected";
    return { state };
  },
};

/**
 * The counts for `loaders`, each settled on its own. Unknown or repeated names
 * are read once; a loader that throws is logged and comes back `null`.
 */
export async function loadAdminOverview(
  loaders: readonly CountLoader[],
  options: { db?: Db; userId?: string | null } = {}
): Promise<AdminOverview> {
  const db = options.db ?? (await getDb());
  const ctx: OverviewContext = { db, userId: options.userId ?? null };
  const wanted = [...new Set(loaders)].filter((name) => name in COUNT_LOADER_READS);

  const settled = await Promise.allSettled(wanted.map((name) => COUNT_LOADER_READS[name](ctx)));
  const out: Record<string, unknown> = {};
  settled.forEach((result, i) => {
    const name = wanted[i];
    if (result.status === "fulfilled") {
      out[name] = result.value;
    } else {
      console.error(`[admin/overview] could not read the ${name} counts`, result.reason);
      out[name] = null;
    }
  });
  return out as AdminOverview;
}

/** Daily counts over `table` by `dayExpr`, oldest first, zero-filled — one statement. */
async function dailySeries(db: Db, dayExpr: ReturnType<typeof sql>, table: ReturnType<typeof sql>): Promise<number[]> {
  const days = SERIES_DAYS;
  const rows = await rawRows<{ age: Num; n: Num }>(
    db,
    sql`select (current_date - ${dayExpr}) as age, count(*) as n
          from ${table}
         where ${dayExpr} > current_date - ${days}::int
         group by 1`
  );
  return fill(rows, days);
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
