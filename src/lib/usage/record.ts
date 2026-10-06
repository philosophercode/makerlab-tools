import { sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { describeDbError } from "../db/describe-error.ts";
import { rawRows } from "../db/raw.ts";
import { usageEvents } from "../db/schema/usage.ts";
import type { Db } from "../db/types.ts";
import { isUuid } from "../data/uuid.ts";
import type { UsageEvent, UsageGapInput } from "./events.ts";
import { gapKey } from "./gap-key.ts";

/**
 * Write usage events (usage insight spec §5.1 step 3).
 *
 * **Recording never costs a student anything.** This never throws: a failed
 * insert logs one `[usage]` warning and returns, and every caller schedules it
 * after the response (`schedule.ts`), so a slow or failing database changes
 * neither the answer nor its timing. Counts are approximate by design.
 *
 * `USAGE_INSIGHT=off` records nothing at all.
 *
 * A gap is upserted by its key (`gap-key.ts`): the same question on the same
 * tool bumps `occurrences`, moves `last_seen` and keeps the **latest**
 * wording, so no stored text is older than the 30-day prune. A dismissed gap
 * asked {@link REOPEN_AFTER} more times opens again; a filed one stays filed.
 * The turn's `gap` event is linked to the row.
 */

/** A dismissed gap asked this many more times is back in the queue (§4). */
export const REOPEN_AFTER = 3;

export function usageEnabled(): boolean {
  return (process.env.USAGE_INSIGHT ?? "").trim().toLowerCase() !== "off";
}

export interface RecordOptions {
  db?: Db;
}

/** Upsert one gap; its row id. */
async function upsertGap(db: Db, gap: UsageGapInput): Promise<string> {
  const toolId = gap.toolId && isUuid(gap.toolId) ? gap.toolId : null;
  const [row] = await rawRows<{ id: string }>(
    db,
    sql`insert into usage_gaps (key, kind, tool_id, question)
        values (${gapKey(gap.question, toolId)}, ${gap.kind}, ${toolId}, ${gap.question})
        on conflict (key) do update set
          occurrences = usage_gaps.occurrences + 1,
          last_seen = now(),
          question = excluded.question,
          kind = excluded.kind,
          status = case
            when usage_gaps.status = 'dismissed'
             and usage_gaps.occurrences + 1 - coalesce(usage_gaps.dismissed_at_occurrences, usage_gaps.occurrences) >= ${REOPEN_AFTER}
            then 'open' else usage_gaps.status end,
          dismissed_at_occurrences = case
            when usage_gaps.status = 'dismissed'
             and usage_gaps.occurrences + 1 - coalesce(usage_gaps.dismissed_at_occurrences, usage_gaps.occurrences) >= ${REOPEN_AFTER}
            then null else usage_gaps.dismissed_at_occurrences end
        returning id`
  );
  return row.id;
}

function clean(event: UsageEvent, gapId: string | null) {
  return {
    kind: event.kind,
    surface: event.surface,
    audience: event.audience,
    toolId: event.toolId && isUuid(event.toolId) ? event.toolId : null,
    manualDocumentId: event.manualDocumentId && isUuid(event.manualDocumentId) ? event.manualDocumentId : null,
    page: typeof event.page === "number" && Number.isFinite(event.page) ? Math.trunc(event.page) : null,
    source: event.source ? String(event.source).slice(0, 80) : null,
    questionKind: event.questionKind ?? null,
    locale: event.locale ? String(event.locale).slice(0, 16) : null,
    gapId,
  };
}

/** Record `events` (and `gaps`). Never throws; answers whether it landed, for tests and logs. */
export async function recordUsage(events: readonly UsageEvent[], gaps: readonly UsageGapInput[] = [], options: RecordOptions = {}): Promise<boolean> {
  if (!usageEnabled() || (events.length === 0 && gaps.length === 0)) return false;
  try {
    const db = options.db ?? (await getDb());
    let gapId: string | null = null;
    for (const gap of gaps) gapId = await upsertGap(db, gap);
    const rows = events.map((event) => clean(event, event.kind === "gap" ? gapId : null));
    if (rows.length > 0) await db.insert(usageEvents).values(rows);
    return true;
  } catch (err) {
    // Never the error's message: Drizzle's lists the bound values, and a gap's are a student's question.
    console.warn("[usage] could not record usage; the counts will be a little low", describeDbError(err));
    return false;
  }
}
