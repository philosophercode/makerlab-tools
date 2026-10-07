import { and, asc, eq, inArray, lte, sql, type SQL } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { rawRows } from "../db/raw.ts";
import { maintenanceCompletions, maintenanceSchedules, tools, units } from "../db/schema/index.ts";
import { SCHEDULE_STATUS, type ScheduleIntervalUnit, type ScheduleStatus } from "../db/schema/vocabulary.ts";
import type { Db } from "../db/types.ts";
import { addInterval, DUE_SOON_DAYS, dueState, nextDueAfterDone, overdueDays, type DueState, type ScheduleInterval } from "../maintenance/interval.ts";
import { isUuid } from "./uuid.ts";

/**
 * Recurring maintenance on Postgres (recurring maintenance spec, amendment
 * 2026-10-06 "v1: a checklist, not tickets"): the schedules staff define, the
 * due list built from them, and the check-off that logs a completion and
 * moves the next due date forward.
 *
 * Every function takes "today" from its caller — the action layer passes
 * `labToday()` — so the date maths is testable and never reads the server
 * clock. Overdue is derived here, never stored.
 *
 * Relative imports with `.ts` extensions, no `@/` alias, no `"server-only"`:
 * `scripts/` loads `src/lib/data` under plain Node.
 */

export const SCHEDULE_TITLE_MAX = 120;
export const SCHEDULE_INSTRUCTIONS_MAX = 2000;
export const COMPLETION_NOTE_MAX = 1000;

/** How many of a task's latest check-offs a list shows. */
export const RECENT_COMPLETIONS = 5;

/** A list is for a person to read: bounded (Article 4). */
const LIST_LIMIT = 500;

/** One check-off, as a list shows it. */
export interface CompletionView {
  id: string;
  doneOn: string;
  dueOn: string;
  note: string | null;
  /** The snapshot taken when it was done; survives the account's removal. */
  doneByName: string | null;
}

/** One schedule, with where it lives and its latest check-offs. */
export interface ScheduleView {
  id: string;
  title: string;
  instructions: string | null;
  /** Null for general lab upkeep. */
  toolId: string | null;
  toolName: string | null;
  toolSlug: string | null;
  /** The tool was archived after the task was set up: the task still shows, and says so. */
  toolArchived: boolean;
  unitId: string | null;
  unitLabel: string | null;
  interval: ScheduleInterval;
  nextDueOn: string;
  lastDoneOn: string | null;
  status: ScheduleStatus;
  /** Newest first, at most {@link RECENT_COMPLETIONS}. */
  recent: CompletionView[];
}

/** A schedule on the due list, with where it stands today. */
export interface DueItem extends ScheduleView {
  state: DueState;
  /** 0 when not yet overdue. */
  overdueDays: number;
}

export interface ScheduleReadOptions {
  db?: Db;
}

async function handle(options: ScheduleReadOptions): Promise<Db> {
  return options.db ?? (await getDb());
}

/** Rows joined to their tool and unit, oldest due first; completions attached. */
async function selectSchedules(db: Db, where: SQL | undefined): Promise<ScheduleView[]> {
  const rows = await db
    .select({
      id: maintenanceSchedules.id,
      title: maintenanceSchedules.title,
      instructions: maintenanceSchedules.instructions,
      toolId: maintenanceSchedules.toolId,
      toolName: tools.name,
      toolSlug: tools.slug,
      toolArchivedAt: tools.archivedAt,
      unitId: maintenanceSchedules.unitId,
      unitLabel: units.unitLabel,
      intervalCount: maintenanceSchedules.intervalCount,
      intervalUnit: maintenanceSchedules.intervalUnit,
      nextDueOn: maintenanceSchedules.nextDueOn,
      lastDoneOn: maintenanceSchedules.lastDoneOn,
      status: maintenanceSchedules.status,
    })
    .from(maintenanceSchedules)
    .leftJoin(tools, eq(tools.id, maintenanceSchedules.toolId))
    .leftJoin(units, eq(units.id, maintenanceSchedules.unitId))
    .where(where)
    .orderBy(asc(maintenanceSchedules.nextDueOn), asc(maintenanceSchedules.title))
    .limit(LIST_LIMIT);

  const recent = await recentCompletions(
    db,
    rows.map((row) => row.id)
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    instructions: row.instructions,
    toolId: row.toolId,
    toolName: row.toolName,
    toolSlug: row.toolSlug,
    toolArchived: row.toolArchivedAt !== null && row.toolArchivedAt !== undefined,
    unitId: row.unitId,
    unitLabel: row.unitLabel,
    interval: { count: row.intervalCount, unit: row.intervalUnit as ScheduleIntervalUnit },
    nextDueOn: row.nextDueOn,
    lastDoneOn: row.lastDoneOn,
    status: row.status as ScheduleStatus,
    recent: recent.get(row.id) ?? [],
  }));
}

/** The latest check-offs of each schedule, newest first — one statement, bounded per schedule. */
async function recentCompletions(db: Db, scheduleIds: string[]): Promise<Map<string, CompletionView[]>> {
  const out = new Map<string, CompletionView[]>();
  if (scheduleIds.length === 0) return out;
  const ids = sql.join(
    scheduleIds.map((id) => sql`${id}::uuid`),
    sql`, `
  );
  const rows = await rawRows<{ id: string; schedule_id: string; done_on: string | Date; due_on: string | Date; note: string | null; done_by_name: string | null }>(
    db,
    sql`select id, schedule_id, done_on, due_on, note, done_by_name
          from (select *, row_number() over (partition by schedule_id order by done_on desc, created_at desc) as rn
                  from maintenance_completions
                 where schedule_id in (${ids})) ranked
         where rn <= ${RECENT_COMPLETIONS}
         order by schedule_id, done_on desc, created_at desc`
  );
  for (const row of rows) {
    const list = out.get(row.schedule_id) ?? [];
    list.push({ id: row.id, doneOn: isoDate(row.done_on), dueOn: isoDate(row.due_on), note: row.note, doneByName: row.done_by_name });
    out.set(row.schedule_id, list);
  }
  return out;
}

/** A raw `date` comes back as a string from one driver and a Date from another. */
function isoDate(value: string | Date): string {
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

/** Every schedule in `statuses` (all of them by default), oldest due first. */
export async function listSchedules(options: ScheduleReadOptions & { statuses?: readonly ScheduleStatus[] } = {}): Promise<ScheduleView[]> {
  const db = await handle(options);
  const statuses = options.statuses ?? SCHEDULE_STATUS;
  return selectSchedules(db, inArray(maintenanceSchedules.status, [...statuses]));
}

/** One schedule, or null for an unknown id. */
export async function getSchedule(id: string, options: ScheduleReadOptions = {}): Promise<ScheduleView | null> {
  if (!isUuid(id)) return null;
  const db = await handle(options);
  const [row] = await selectSchedules(db, eq(maintenanceSchedules.id, id));
  return row ?? null;
}

/**
 * The due list: active schedules due on or before `today + withinDays`,
 * overdue first (they have the oldest dates). Paused and archived tasks never
 * appear, however late.
 */
export async function listDueSchedules(
  today: string,
  options: ScheduleReadOptions & { withinDays?: number } = {}
): Promise<DueItem[]> {
  const db = await handle(options);
  const withinDays = Math.max(0, Math.floor(options.withinDays ?? DUE_SOON_DAYS));
  // 0 means "due today or overdue".
  const horizon = withinDays > 0 ? addInterval(today, { count: withinDays, unit: "day" }) : today;
  const rows = await selectSchedules(
    db,
    and(eq(maintenanceSchedules.status, "active"), lte(maintenanceSchedules.nextDueOn, horizon))
  );
  return rows.map((row) => ({
    ...row,
    state: dueState(row.nextDueOn, today, withinDays),
    overdueDays: overdueDays(row.nextDueOn, today),
  }));
}

/** The numbers the `/admin` maintenance tile and the page header show. */
export interface DueCounts {
  overdue: number;
  dueToday: number;
  /** Due after today and within {@link DUE_SOON_DAYS} days. */
  soon: number;
  /** Every active schedule. */
  active: number;
}

export async function countDueSchedules(today: string, options: ScheduleReadOptions = {}): Promise<DueCounts> {
  const db = await handle(options);
  const horizon = addInterval(today, { count: DUE_SOON_DAYS, unit: "day" });
  const [row] = await rawRows<Record<string, number | string | null>>(
    db,
    sql`select count(*) filter (where next_due_on < ${today}::date) as overdue,
               count(*) filter (where next_due_on = ${today}::date) as due_today,
               count(*) filter (where next_due_on > ${today}::date and next_due_on <= ${horizon}::date) as soon,
               count(*) as active
          from maintenance_schedules
         where status = 'active'`
  );
  return {
    overdue: Number(row?.overdue ?? 0),
    dueToday: Number(row?.due_today ?? 0),
    soon: Number(row?.soon ?? 0),
    active: Number(row?.active ?? 0),
  };
}

/** A tool's units still in the lab (not retired), by label — what "each unit" creates a task for. */
export async function listActiveUnitsOfTool(toolId: string, options: ScheduleReadOptions = {}): Promise<{ id: string; label: string }[]> {
  if (!isUuid(toolId)) return [];
  const db = await handle(options);
  const rows = await db
    .select({ id: units.id, label: units.unitLabel, status: units.status })
    .from(units)
    .where(eq(units.toolId, toolId))
    .orderBy(asc(units.unitLabel));
  return rows.filter((row) => row.status !== "retired").map((row) => ({ id: row.id, label: row.label }));
}

// ── Writes ──────────────────────────────────────────────────────────

export interface ScheduleActor {
  userId: string;
  name: string;
}

export interface NewSchedule {
  toolId: string | null;
  unitId: string | null;
  title: string;
  instructions: string | null;
  interval: ScheduleInterval;
  firstDueOn: string;
}

/**
 * Create one or more schedules in one transaction — several when staff chose
 * "each unit" for a tool, so either every unit gets its task or none does.
 */
export async function createSchedules(
  rows: readonly NewSchedule[],
  actor: ScheduleActor,
  options: ScheduleReadOptions = {}
): Promise<string[]> {
  if (rows.length === 0) return [];
  const db = await handle(options);
  const inserted = await db
    .insert(maintenanceSchedules)
    .values(
      rows.map((row) => ({
        toolId: row.toolId,
        unitId: row.unitId,
        title: row.title,
        instructions: row.instructions,
        intervalCount: row.interval.count,
        intervalUnit: row.interval.unit,
        nextDueOn: row.firstDueOn,
        status: "active",
        createdBy: actor.userId,
        updatedBy: actor.userId,
      }))
    )
    .returning({ id: maintenanceSchedules.id });
  return inserted.map((row) => row.id);
}

export interface SchedulePatch {
  toolId: string | null;
  unitId: string | null;
  title: string;
  instructions: string | null;
  interval: ScheduleInterval;
  nextDueOn: string;
}

export type ScheduleWriteResult = { ok: true } | { ok: false; error: "not_found" };

/** Replace a schedule's fields. Its log stays; the next check-off uses the new interval. */
export async function updateSchedule(
  id: string,
  patch: SchedulePatch,
  actor: ScheduleActor,
  options: ScheduleReadOptions = {}
): Promise<ScheduleWriteResult> {
  if (!isUuid(id)) return { ok: false, error: "not_found" };
  const db = await handle(options);
  const updated = await db
    .update(maintenanceSchedules)
    .set({
      toolId: patch.toolId,
      unitId: patch.unitId,
      title: patch.title,
      instructions: patch.instructions,
      intervalCount: patch.interval.count,
      intervalUnit: patch.interval.unit,
      nextDueOn: patch.nextDueOn,
      updatedBy: actor.userId,
    })
    .where(eq(maintenanceSchedules.id, id))
    .returning({ id: maintenanceSchedules.id });
  return updated.length > 0 ? { ok: true } : { ok: false, error: "not_found" };
}

/** Pause, resume or archive a schedule. Resuming keeps the due date it had. */
export async function setScheduleStatus(
  id: string,
  status: ScheduleStatus,
  actor: ScheduleActor,
  options: ScheduleReadOptions = {}
): Promise<ScheduleWriteResult> {
  if (!isUuid(id)) return { ok: false, error: "not_found" };
  const db = await handle(options);
  const updated = await db
    .update(maintenanceSchedules)
    .set({ status, updatedBy: actor.userId })
    .where(eq(maintenanceSchedules.id, id))
    .returning({ id: maintenanceSchedules.id });
  return updated.length > 0 ? { ok: true } : { ok: false, error: "not_found" };
}

export interface CompleteScheduleInput {
  id: string;
  note: string | null;
  /**
   * The due date the person saw. When the schedule no longer has it,
   * somebody else checked it off (or edited it) first, and this click is
   * refused as `conflict` rather than logging the same work twice.
   */
  expectedDueOn: string | null;
  /** The lab's today (`labToday()`). */
  today: string;
  actor: ScheduleActor;
}

export type CompleteScheduleResult =
  | { ok: true; completionId: string; doneOn: string; nextDueOn: string }
  | { ok: false; error: "not_found" | "conflict" };

/**
 * **Done.** In one transaction, with the schedule's row locked: log the
 * completion (done today, against the due date it answered) and move
 * `next_due_on` to today + interval (floating, §13 Q1). Only an active
 * schedule can be checked off; a paused or archived one answers `conflict`,
 * because the page that offered **Done** showed it active.
 */
export async function completeSchedule(input: CompleteScheduleInput, options: ScheduleReadOptions = {}): Promise<CompleteScheduleResult> {
  if (!isUuid(input.id)) return { ok: false, error: "not_found" };
  const db = await handle(options);
  return db.transaction(async (tx): Promise<CompleteScheduleResult> => {
    const [row] = await tx
      .select({
        id: maintenanceSchedules.id,
        status: maintenanceSchedules.status,
        nextDueOn: maintenanceSchedules.nextDueOn,
        intervalCount: maintenanceSchedules.intervalCount,
        intervalUnit: maintenanceSchedules.intervalUnit,
      })
      .from(maintenanceSchedules)
      .where(eq(maintenanceSchedules.id, input.id))
      .for("update");
    if (!row) return { ok: false, error: "not_found" };
    if (row.status !== "active") return { ok: false, error: "conflict" };
    if (input.expectedDueOn && row.nextDueOn !== input.expectedDueOn) return { ok: false, error: "conflict" };

    const interval: ScheduleInterval = { count: row.intervalCount, unit: row.intervalUnit as ScheduleIntervalUnit };
    const nextDueOn = nextDueAfterDone(input.today, interval);
    const [completion] = await tx
      .insert(maintenanceCompletions)
      .values({
        scheduleId: row.id,
        doneOn: input.today,
        dueOn: row.nextDueOn,
        note: input.note,
        doneByUserId: input.actor.userId,
        doneByName: input.actor.name || null,
      })
      .returning({ id: maintenanceCompletions.id });
    await tx
      .update(maintenanceSchedules)
      .set({ lastDoneOn: input.today, nextDueOn, updatedBy: input.actor.userId })
      .where(eq(maintenanceSchedules.id, row.id));
    return { ok: true, completionId: completion.id, doneOn: input.today, nextDueOn };
  });
}
