import { sql, type SQL } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { rawRows } from "../db/raw.ts";
import type { Db } from "../db/types.ts";
import { labTimezone } from "../lab-time.ts";
import { QUESTION_KINDS, type GapKind, type QuestionKind } from "../db/schema/vocabulary.ts";

/**
 * The reads behind `/admin/insights` (usage insight spec §6) and its tile.
 *
 * **One source, two tables.** Every count reads {@link usageSource}: the
 * hourly rollups for the hours already rolled up, and the raw events for
 * everything since — split at the watermark (the last rolled hour + 1h), so
 * an event is counted once whether or not tonight's cron has run. A rollup's
 * hour stands for all its events.
 *
 * **Lab time.** Days and the busiest-times grid are in `LAB_TIMEZONE`
 * (converted here, once), so an event at 21:30 New York time is in the 21:00
 * cell on either side of a DST change.
 *
 * **Staff are left out unless asked** (`includeStaff`), so a SuperMaker
 * testing the assistant does not top "most asked about". **Demo passes are
 * always left out** (demo pass spec 2026-10-07 §5.5): a conference's visitors
 * are not the lab's usage.
 */

export const INSIGHT_PERIODS = [7, 30, 90] as const;
export type InsightPeriod = (typeof INSIGHT_PERIODS)[number];

/**
 * The time zone the Insights reads use: `LAB_TIMEZONE`, or UTC when `Intl`
 * does not recognise it. Shared by the page and MCP's `get_usage_summary`, so
 * both put an event in the same lab day and hour.
 */
export function insightsTimeZone(timeZone: string = labTimezone()): string {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

export interface InsightsQuery {
  days: InsightPeriod;
  includeStaff: boolean;
  timeZone: string;
  now?: Date;
}

export interface InsightTotals {
  chatTurns: number;
  mcpCalls: number;
  toolViews: number;
  qrScans: number;
  kioskScreens: number;
  kioskScans: number;
  gaps: number;
  citations: number;
  /**
   * Citations of another machine's document than the one the answer was about
   * (`manual_cited` with `source = 'cross_tool'`; manual text spec amendment
   * 2026-10-06). Counted in `citations` too.
   */
  crossToolCitations: number;
}

export interface ToolInsight {
  /** Null when the tool has since been deleted. */
  toolId: string | null;
  name: string | null;
  slug: string | null;
  asked: number;
  askedChat: number;
  askedMcp: number;
  views: number;
  qr: number;
  citations: number;
  gaps: number;
}

export interface QuietTool {
  toolId: string;
  name: string;
  slug: string;
}

export interface ManualInsight {
  documentId: string | null;
  title: string | null;
  toolName: string | null;
  toolSlug: string | null;
  citations: number;
  topPages: { page: number; count: number }[];
}

export interface GapRow {
  id: string;
  question: string;
  kind: GapKind;
  toolId: string | null;
  toolName: string | null;
  toolSlug: string | null;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
}

export interface InsightsData {
  /** The first event ever counted, or null before there is one ("Counting since …"). */
  since: string | null;
  totals: InsightTotals;
  tools: ToolInsight[];
  neverAsked: QuietTool[];
  /** One entry per lab day in the period, oldest first. */
  days: string[];
  kinds: Record<QuestionKind, number[]>;
  /** [day of week 0 = Sunday][hour 0–23]: chat turns + tool page views, lab time. */
  heatmap: number[][];
  manuals: ManualInsight[];
  gaps: GapRow[];
  gapCounts: { open: number; dismissed: number; filed: number };
}

type Num = number | string | null;
const n = (value: Num | undefined) => Number(value ?? 0);

/**
 * Every counted event in the window as `(ts, kind, surface, audience, tool_id,
 * manual_document_id, page, source, question_kind, count)`.
 */
export function usageSource(query: { days: number; includeStaff: boolean; now: Date }): SQL {
  const now = query.now.toISOString();
  const from = sql`${now}::timestamptz - make_interval(days => ${query.days})`;
  return sourceWithin(from, sql`${now}::timestamptz`, true, query.includeStaff);
}

/**
 * The same source over `[start, end)` — the value report's periods, which are
 * lab dates rather than "the last N days". A rollup hour counts when it starts
 * inside the window.
 */
export function usageSourceBetween(query: { start: Date; end: Date; includeStaff: boolean }): SQL {
  return sourceWithin(sql`${query.start.toISOString()}::timestamptz`, sql`${query.end.toISOString()}::timestamptz`, false, query.includeStaff);
}

function sourceWithin(from: SQL, to: SQL, endInclusive: boolean, includeStaff: boolean): SQL {
  // Demo passes are never the lab's numbers (demo pass spec 2026-10-07 §5.5);
  // staff are left out unless asked.
  const audience = includeStaff ? sql`audience <> 'demo'` : sql`audience not in ('staff', 'demo')`;
  const rawEnd = endInclusive ? sql`occurred_at <= ${to}` : sql`occurred_at < ${to}`;
  const rollupEnd = endInclusive ? sql`true` : sql`hour_start < ${to}`;
  return sql`(
    with mark as (
      select coalesce(max(hour_start) + interval '1 hour', '-infinity'::timestamptz) as wm from usage_rollups
    )
    select hour_start as ts, kind, surface, audience, tool_id, manual_document_id, page, source, question_kind, count
      from usage_rollups, mark
     where hour_start < mark.wm and hour_start >= ${from} and ${rollupEnd} and ${audience}
    union all
    select occurred_at as ts, kind, surface, audience, tool_id, manual_document_id, page, source, question_kind, 1 as count
      from usage_events, mark
     where occurred_at >= mark.wm and occurred_at >= ${from} and ${rawEnd} and ${audience}
  )`;
}

/** The lab's date strings for the last `days` days, oldest first. */
export function labDays(days: number, now: Date, timeZone: string): string[] {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) out.push(fmt.format(new Date(now.getTime() - i * 86_400_000)));
  return [...new Set(out)];
}

export async function loadInsights(query: InsightsQuery, options: { db?: Db } = {}): Promise<InsightsData> {
  const db = options.db ?? (await getDb());
  const now = query.now ?? new Date();
  const src = usageSource({ days: query.days, includeStaff: query.includeStaff, now });
  const tz = query.timeZone;

  const [sinceRows, totalsRows, toolRows, quietRows, kindRows, heatRows, manualRows, gapRows, gapCountRows] = await Promise.all([
    rawRows<{ since: string | Date | null }>(
      db,
      sql`select least((select min(hour_start) from usage_rollups), (select min(occurred_at) from usage_events)) as since`
    ),
    rawRows<Record<string, Num>>(
      db,
      sql`select coalesce(sum(count) filter (where kind = 'chat_turn'), 0) as chat_turns,
                 coalesce(sum(count) filter (where kind = 'mcp_call'), 0) as mcp_calls,
                 coalesce(sum(count) filter (where kind = 'tool_view'), 0) as tool_views,
                 coalesce(sum(count) filter (where kind = 'tool_view' and source = 'qr'), 0) as qr_scans,
                 coalesce(sum(count) filter (where kind = 'kiosk_view' and source = 'screen'), 0) as kiosk_screens,
                 coalesce(sum(count) filter (where kind = 'kiosk_view' and source = 'qr'), 0) as kiosk_scans,
                 coalesce(sum(count) filter (where kind = 'gap'), 0) as gaps,
                 coalesce(sum(count) filter (where kind = 'manual_cited'), 0) as citations,
                 coalesce(sum(count) filter (where kind = 'manual_cited' and source = 'cross_tool'), 0) as cross_tool_citations
            from ${src} e`
    ),
    rawRows<Record<string, Num>>(
      db,
      sql`select e.tool_id, t.name, t.slug,
                 coalesce(sum(count) filter (where kind = 'tool_asked'), 0) as asked,
                 coalesce(sum(count) filter (where kind = 'tool_asked' and surface = 'chat'), 0) as asked_chat,
                 coalesce(sum(count) filter (where kind = 'tool_asked' and surface = 'mcp'), 0) as asked_mcp,
                 coalesce(sum(count) filter (where kind = 'tool_view'), 0) as views,
                 coalesce(sum(count) filter (where kind = 'tool_view' and source = 'qr'), 0) as qr,
                 coalesce(sum(count) filter (where kind = 'manual_cited'), 0) as citations,
                 coalesce(sum(count) filter (where kind = 'gap'), 0) as gaps
            from ${src} e
            left join tools t on t.id = e.tool_id
           where e.kind in ('tool_asked', 'tool_view', 'manual_cited', 'gap')
             and (e.tool_id is not null or e.kind in ('tool_asked', 'tool_view'))
           group by e.tool_id, t.name, t.slug
           order by asked desc, views desc, t.name`
    ),
    rawRows<{ id: string; name: string; slug: string }>(
      db,
      sql`select t.id, t.name, t.slug
            from tools t
           where t.published and t.archived_at is null
             and not exists (select 1 from ${src} e where e.tool_id = t.id and e.kind in ('tool_asked', 'tool_view'))
           order by t.name`
    ),
    rawRows<{ day: string; question_kind: string | null; n: Num }>(
      db,
      sql`select to_char((ts at time zone ${tz})::date, 'YYYY-MM-DD') as day, question_kind, sum(count) as n
            from ${src} e
           where kind = 'chat_turn'
           group by 1, 2`
    ),
    rawRows<{ dow: Num; hour: Num; n: Num }>(
      db,
      sql`select extract(dow from ts at time zone ${tz})::int as dow, extract(hour from ts at time zone ${tz})::int as hour, sum(count) as n
            from ${src} e
           where kind in ('chat_turn', 'tool_view')
           group by 1, 2`
    ),
    rawRows<{ document_id: string | null; title: string | null; tool_name: string | null; tool_slug: string | null; page: Num; n: Num }>(
      db,
      sql`select e.manual_document_id as document_id, d.title, t.name as tool_name, t.slug as tool_slug, e.page, sum(count) as n
            from ${src} e
            left join manual_documents d on d.id = e.manual_document_id
            left join tools t on t.id = coalesce(d.tool_id, e.tool_id)
           where e.kind = 'manual_cited'
           group by 1, 2, 3, 4, 5`
    ),
    rawRows<Record<string, unknown>>(
      db,
      sql`select g.id, g.question, g.kind, g.tool_id, t.name as tool_name, t.slug as tool_slug, g.occurrences, g.first_seen, g.last_seen
            from usage_gaps g
            left join tools t on t.id = g.tool_id
           where g.status = 'open'
           order by g.occurrences desc, g.last_seen desc
           limit 200`
    ),
    rawRows<Record<string, Num>>(
      db,
      sql`select count(*) filter (where status = 'open') as open,
                 count(*) filter (where status = 'dismissed') as dismissed,
                 count(*) filter (where status = 'filed') as filed
            from usage_gaps`
    ),
  ]);

  const totals = totalsRows[0] ?? {};
  const days = labDays(query.days, now, tz);
  const dayIndex = new Map(days.map((day, i) => [day, i]));
  const kinds = Object.fromEntries(QUESTION_KINDS.map((kind) => [kind, new Array<number>(days.length).fill(0)])) as Record<QuestionKind, number[]>;
  for (const row of kindRows) {
    const i = dayIndex.get(row.day);
    const kind = (QUESTION_KINDS as readonly string[]).includes(row.question_kind ?? "") ? (row.question_kind as QuestionKind) : "other";
    if (i !== undefined) kinds[kind][i] += n(row.n);
  }

  const heatmap = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const row of heatRows) {
    const dow = n(row.dow);
    const hour = n(row.hour);
    if (dow >= 0 && dow < 7 && hour >= 0 && hour < 24) heatmap[dow][hour] += n(row.n);
  }

  const manualsById = new Map<string, ManualInsight>();
  for (const row of manualRows) {
    const key = row.document_id ?? "deleted";
    const entry = manualsById.get(key) ?? {
      documentId: row.document_id,
      title: row.title,
      toolName: row.tool_name,
      toolSlug: row.tool_slug,
      citations: 0,
      topPages: [],
    };
    entry.citations += n(row.n);
    if (row.page !== null) entry.topPages.push({ page: n(row.page), count: n(row.n) });
    manualsById.set(key, entry);
  }
  const manuals = [...manualsById.values()]
    .map((m) => ({ ...m, topPages: mergePages(m.topPages).slice(0, 3) }))
    .sort((a, b) => b.citations - a.citations);

  const since = sinceRows[0]?.since;
  return {
    since: since ? new Date(since).toISOString() : null,
    totals: {
      chatTurns: n(totals.chat_turns),
      mcpCalls: n(totals.mcp_calls),
      toolViews: n(totals.tool_views),
      qrScans: n(totals.qr_scans),
      kioskScreens: n(totals.kiosk_screens),
      kioskScans: n(totals.kiosk_scans),
      gaps: n(totals.gaps),
      citations: n(totals.citations),
      crossToolCitations: n(totals.cross_tool_citations),
    },
    tools: toolRows
      .map((row) => ({
        toolId: (row.tool_id as string | null) ?? null,
        name: (row.name as string | null) ?? null,
        slug: (row.slug as string | null) ?? null,
        asked: n(row.asked),
        askedChat: n(row.asked_chat),
        askedMcp: n(row.asked_mcp),
        views: n(row.views),
        qr: n(row.qr),
        citations: n(row.citations),
        gaps: n(row.gaps),
      }))
      .filter((row) => row.asked + row.views + row.citations + row.gaps > 0),
    neverAsked: quietRows.map((row) => ({ toolId: row.id, name: row.name, slug: row.slug })),
    days,
    kinds,
    heatmap,
    manuals,
    gaps: gapRows.map((row) => ({
      id: String(row.id),
      question: String(row.question),
      kind: row.kind as GapKind,
      toolId: (row.tool_id as string | null) ?? null,
      toolName: (row.tool_name as string | null) ?? null,
      toolSlug: (row.tool_slug as string | null) ?? null,
      occurrences: n(row.occurrences as Num),
      firstSeen: new Date(row.first_seen as string).toISOString(),
      lastSeen: new Date(row.last_seen as string).toISOString(),
    })),
    gapCounts: {
      open: n(gapCountRows[0]?.open),
      dismissed: n(gapCountRows[0]?.dismissed),
      filed: n(gapCountRows[0]?.filed),
    },
  };
}

function mergePages(pages: { page: number; count: number }[]): { page: number; count: number }[] {
  const byPage = new Map<number, number>();
  for (const { page, count } of pages) byPage.set(page, (byPage.get(page) ?? 0) + count);
  return [...byPage.entries()].map(([page, count]) => ({ page, count })).sort((a, b) => b.count - a.count || a.page - b.page);
}

/** The Insights tile's number: open gaps in the Unanswered queue. */
export async function countOpenGaps(db: Db): Promise<number> {
  const [row] = await rawRows<{ n: Num }>(db, sql`select count(*) as n from usage_gaps where status = 'open'`);
  return n(row?.n);
}
