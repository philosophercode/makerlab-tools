import { sql } from "drizzle-orm";
import { UNANSWERED_CORRECTION_PREFIX } from "../../data/usage-gaps.ts";
import { getDb } from "../../db/client.ts";
import { rawRows } from "../../db/raw.ts";
import type { Db } from "../../db/types.ts";
import { GAP_KINDS, QUESTION_KINDS, type GapKind, type QuestionKind } from "../../db/schema/vocabulary.ts";
import { usageSourceBetween } from "../queries.ts";
import { emptyCounts, median, type ValueCounts } from "./report.ts";

/**
 * The value report's reads (usage insight spec amendment "Value report"): one
 * period's counts, **staff always left out** — the report is about what the
 * lab's visitors asked, and a SuperMaker testing the assistant is not a
 * question saved.
 *
 * Questions come from the same rollup-plus-raw source as the Insights page
 * (`usageSourceBetween`), bucketed by UTC hour so the lab-time split into
 * staffed and after hours is done once, in `report.ts`, where DST is tested.
 * Corrections, manuals and tickets are read from their own tables, which
 * outlive the 30-day raw events and gaps. Every result is a count; nothing
 * selected names a person.
 */

/** The MCP calls that are a visitor's question to the catalogue — the public reads. */
export const MCP_LOOKUP_TOOLS = ["list_tools", "search_tools", "get_tool_details", "get_unit_details", "get_maintenance_history", "search_manual"] as const;

/** Most-asked tools the report lists. */
export const TOP_TOOLS = 5;

type Num = number | string | null;
const n = (value: Num | undefined) => Number(value ?? 0);

export interface ValueCountsQuery {
  start: Date;
  end: Date;
  /** The period's lab dates, for the tables that store a lab date (tickets). */
  from: string;
  to: string;
}

export async function loadValueCounts(query: ValueCountsQuery, options: { db?: Db } = {}): Promise<ValueCounts> {
  const db = options.db ?? (await getDb());
  const counts = emptyCounts();
  if (query.end.getTime() <= query.start.getTime()) return counts;
  const src = usageSourceBetween({ start: query.start, end: query.end, includeStaff: false });
  const start = query.start.toISOString();
  const end = query.end.toISOString();
  const lookups = sql.join(
    MCP_LOOKUP_TOOLS.map((tool) => sql`${tool}`),
    sql`, `
  );

  const [hourRows, gapRows, kindRows, toolRows, citationRows, correctionRows, manualRows, ticketRows] = await Promise.all([
    rawRows<{ hour: string; chat: Num; mcp: Num }>(
      db,
      sql`select to_char(date_trunc('hour', ts at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:00:00"Z"') as hour,
                 coalesce(sum(count) filter (where kind = 'chat_turn'), 0) as chat,
                 coalesce(sum(count) filter (where kind = 'mcp_call' and source in (${lookups})), 0) as mcp
            from ${src} e
           where kind in ('chat_turn', 'mcp_call')
           group by 1
           order by 1`
    ),
    rawRows<{ source: string | null; n: Num }>(db, sql`select source, sum(count) as n from ${src} e where kind = 'gap' group by source`),
    rawRows<{ question_kind: string | null; n: Num }>(db, sql`select question_kind, sum(count) as n from ${src} e where kind = 'chat_turn' group by question_kind`),
    rawRows<{ tool_id: string | null; name: string | null; slug: string | null; n: Num }>(
      db,
      sql`select e.tool_id, t.name, t.slug, sum(count) as n
            from ${src} e
            left join tools t on t.id = e.tool_id
           where e.kind = 'tool_asked'
           group by e.tool_id, t.name, t.slug
           order by n desc, t.name
           limit ${TOP_TOOLS}`
    ),
    rawRows<{ citations: Num; manuals: Num }>(
      db,
      sql`select coalesce(sum(count), 0) as citations, count(distinct manual_document_id) as manuals from ${src} e where kind = 'manual_cited'`
    ),
    rawRows<{ filed: Num; fixed: Num }>(
      db,
      sql`select count(*) as filed, count(*) filter (where status = 'fixed') as fixed
            from feedback
           where starts_with(issue_description, ${UNANSWERED_CORRECTION_PREFIX})
             and created_at >= ${start}::timestamptz and created_at < ${end}::timestamptz`
    ),
    rawRows<{ n: Num }>(
      db,
      sql`select count(*) as n from manual_documents
           where status = 'ready' and created_at >= ${start}::timestamptz and created_at < ${end}::timestamptz`
    ),
    // A problem report the assistant filed: `report_issue` (chat or MCP) is the
    // only writer of an `issue_report` in the app; imported history carries a
    // Notion page id. Dated by `date_reported`, which is a lab date.
    rawRows<{ days: Num | null; resolved: boolean }>(
      db,
      sql`select case when date_resolved is not null then date_resolved - date_reported end as days,
                 (status in ('resolved', 'closed') and date_resolved is not null) as resolved
            from maintenance_logs
           where type = 'issue_report' and notion_page_id is null and not demo
             and coalesce(date_reported, (created_at at time zone 'UTC')::date) between ${query.from}::date and ${query.to}::date
             and created_at < ${end}::timestamptz`
    ),
  ]);

  counts.hourly = hourRows.map((row) => ({ hour: row.hour, chatTurns: n(row.chat), mcpLookups: n(row.mcp) })).filter((h) => h.chatTurns + h.mcpLookups > 0);
  for (const row of gapRows) {
    if ((GAP_KINDS as readonly string[]).includes(row.source ?? "")) counts.gapsByKind[row.source as GapKind] += n(row.n);
  }
  for (const row of kindRows) {
    const kind = (QUESTION_KINDS as readonly string[]).includes(row.question_kind ?? "") ? (row.question_kind as QuestionKind) : "other";
    counts.questionKinds[kind] += n(row.n);
  }
  counts.topTools = toolRows.map((row) => ({ toolId: row.tool_id, name: row.name, slug: row.slug, asked: n(row.n) }));
  counts.citations = n(citationRows[0]?.citations);
  counts.manualsCited = n(citationRows[0]?.manuals);
  counts.unansweredFiled = n(correctionRows[0]?.filed);
  counts.unansweredFixed = n(correctionRows[0]?.fixed);
  counts.manualsAdded = n(manualRows[0]?.n);
  counts.ticketsFiled = ticketRows.length;
  const resolvedDays = ticketRows.filter((row) => row.resolved && row.days !== null).map((row) => Math.max(0, n(row.days)));
  counts.ticketsResolved = resolvedDays.length;
  counts.medianDaysToResolve = median(resolvedDays);
  return counts;
}

/** The first usage event ever counted, or null — "Counting since …". */
export async function countingSince(options: { db?: Db } = {}): Promise<string | null> {
  const db = options.db ?? (await getDb());
  const [row] = await rawRows<{ since: string | Date | null }>(
    db,
    sql`select least((select min(hour_start) from usage_rollups), (select min(occurred_at) from usage_events)) as since`
  );
  return row?.since ? new Date(row.since).toISOString() : null;
}
