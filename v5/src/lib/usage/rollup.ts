import { sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { rawRows } from "../db/raw.ts";
import type { Db } from "../db/types.ts";

/**
 * The daily cron's usage stage (usage insight spec §5.4): roll raw events up
 * into hourly counts, then forget them.
 *
 * 1. **Roll up.** Every complete hour still in `usage_events` is recounted
 *    and its `usage_rollups` rows replaced, in one transaction. Replacing
 *    (rather than adding) is what makes a re-run idempotent, and recounting
 *    every hour still held (≤ 30 days, a few hundred thousand rows at the
 *    lab's scale) keeps it exact when a tool is deleted and its events' ids go
 *    null. The hour in progress is left for the next run. Hours are UTC
 *    (`date_trunc(…, 'UTC')`); the page converts to lab time.
 * 2. **Prune raw events** older than {@link RAW_RETENTION_DAYS} days, cut on
 *    an hour boundary so the oldest hour left is always whole. Their counts
 *    are already in the rollups, which are kept indefinitely and name nobody.
 * 3. **Prune the Unanswered queue**: a gap last asked more than
 *    {@link GAP_RETENTION_DAYS} days ago is deleted, question text and all
 *    (owner decision 2026-09-28: the text of unanswered questions is kept 30
 *    days, then only counts). Its `gap` events' counts stay in the rollups.
 *
 * A throw fails the stage; the cron route reports it like every other stage.
 */

export const RAW_RETENTION_DAYS = 30;
export const GAP_RETENTION_DAYS = 30;

export interface UsageRollupResult {
  /** Hourly rows written this run. */
  rollupRows: number;
  prunedEvents: number;
  prunedGaps: number;
}

export async function runUsageRollup(options: { db?: Db; now?: Date } = {}): Promise<UsageRollupResult> {
  const db = options.db ?? (await getDb());
  const now = (options.now ?? new Date()).toISOString();

  const rollupRows = await db.transaction(async (tx) => {
    const bounds = sql`date_trunc('hour', ${now}::timestamptz, 'UTC')`;
    await tx.execute(
      sql`delete from usage_rollups
           where hour_start >= (select date_trunc('hour', min(occurred_at), 'UTC') from usage_events)
             and hour_start < ${bounds}`
    );
    const written = await rawRows<{ n: number | string }>(
      tx as unknown as Db,
      sql`with inserted as (
            insert into usage_rollups (hour_start, kind, surface, audience, tool_id, manual_document_id, page, source, question_kind, count)
            select date_trunc('hour', occurred_at, 'UTC'), kind, surface, audience, tool_id, manual_document_id, page, source, question_kind, count(*)::int
              from usage_events
             where occurred_at < ${bounds}
             group by 1, 2, 3, 4, 5, 6, 7, 8, 9
            returning 1)
          select count(*) as n from inserted`
    );
    return Number(written[0]?.n ?? 0);
  });

  const pruned = await rawRows<{ n: number | string }>(
    db,
    sql`with gone as (
          delete from usage_events
           where occurred_at < date_trunc('hour', ${now}::timestamptz - make_interval(days => ${RAW_RETENTION_DAYS}), 'UTC')
             and occurred_at < date_trunc('hour', ${now}::timestamptz, 'UTC')
          returning 1)
        select count(*) as n from gone`
  );
  const prunedGaps = await rawRows<{ n: number | string }>(
    db,
    sql`with gone as (
          delete from usage_gaps
           where last_seen < ${now}::timestamptz - make_interval(days => ${GAP_RETENTION_DAYS})
          returning 1)
        select count(*) as n from gone`
  );

  return { rollupRows, prunedEvents: Number(pruned[0]?.n ?? 0), prunedGaps: Number(prunedGaps[0]?.n ?? 0) };
}
