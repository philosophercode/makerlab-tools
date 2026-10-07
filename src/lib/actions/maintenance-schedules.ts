import "server-only";

import { z } from "zod";
import { MAINTENANCE_PATH } from "../../app/admin/maintenance/action-result";
import { SCHEDULES_PATH, type ScheduleWriteError } from "../../app/admin/maintenance/schedule-result";
import { findActiveToolByRef, findUnitOfTool, toolSubjects } from "../data/action-subjects";
import {
  COMPLETION_NOTE_MAX,
  completeSchedule,
  createSchedules,
  getSchedule,
  listActiveUnitsOfTool,
  SCHEDULE_INSTRUCTIONS_MAX,
  SCHEDULE_TITLE_MAX,
  setScheduleStatus,
  updateSchedule,
  type NewSchedule,
  type ScheduleActor,
} from "../data/maintenance-schedules";
import { SCHEDULE_INTERVAL_UNIT, SCHEDULE_STATUS, isOneOf, type ScheduleIntervalUnit, type ScheduleStatus } from "../db/schema/vocabulary";
import { labToday } from "../lab-time";
import { daysBetween, isIsoDate, isValidInterval, type ScheduleInterval } from "../maintenance/interval";
import { defineAction, type ActionContext } from "./define";

/**
 * Recurring maintenance (recurring maintenance spec, amendment 2026-10-06):
 * staff set up tasks the lab repeats, and a SuperMaker checks one off with
 * **Done**. Four definitions, all `maintenance.manage` — anyone who can work
 * the ticket queue can plan and do the upkeep — and all `operational`: queue
 * work, reversible, no catalogue change.
 *
 * **GUI only in v1** (`assistant: "never"`, so never MCP either). The
 * assistant can *read* what is due (`list_maintenance_due`, the staff
 * capability); proposing a task or checking one off from the chat needs a
 * confirmation card and its strings, which the spec lists as a follow-up.
 *
 * No audit event (§4.11: ordinary records, and each row names who wrote it)
 * and no Notion mirror (schedules are staff configuration, spec §2).
 */

const GUI_ONLY = "Recurring maintenance v1 is GUI only; assistant proposals are a listed follow-up (recurring maintenance spec, amendment 2026-10-06)";

/** How far from today a due date may be set: ten years either way catches a mistyped year. */
const DUE_DATE_RANGE_DAYS = 3660;

const PATHS = [MAINTENANCE_PATH, SCHEDULES_PATH, "/admin"];

const id = z.string().max(64);

const fieldsSchema = z.object({
  title: z.string().max(SCHEDULE_TITLE_MAX * 2),
  instructions: z.string().max(SCHEDULE_INSTRUCTIONS_MAX * 2),
  toolId: id.nullable(),
  unitId: id.nullable(),
  eachUnit: z.boolean(),
  intervalCount: z.number(),
  intervalUnit: z.string().max(20),
  dueOn: z.string().max(20),
});

type Fields = z.infer<typeof fieldsSchema>;

interface Target {
  toolId: string | null;
  unitId: string | null;
}

interface CleanFields {
  title: string;
  instructions: string | null;
  interval: ScheduleInterval;
  dueOn: string;
}

type Checked<T> = { ok: true; value: T } | { ok: false; error: ScheduleWriteError };

/** The text, interval and date as they will be stored, or `invalid_field`. Reads nothing. */
function clean(fields: Fields, today: string): Checked<CleanFields> {
  const title = fields.title.replace(/\s+/g, " ").trim();
  const instructions = fields.instructions.trim();
  if (!title || title.length > SCHEDULE_TITLE_MAX) return { ok: false, error: "invalid_field" };
  if (instructions.length > SCHEDULE_INSTRUCTIONS_MAX) return { ok: false, error: "invalid_field" };
  if (!isOneOf(SCHEDULE_INTERVAL_UNIT, fields.intervalUnit)) return { ok: false, error: "invalid_field" };
  const interval = { count: fields.intervalCount, unit: fields.intervalUnit as ScheduleIntervalUnit };
  if (!isValidInterval(interval)) return { ok: false, error: "invalid_field" };
  if (!isIsoDate(fields.dueOn) || Math.abs(daysBetween(today, fields.dueOn)) > DUE_DATE_RANGE_DAYS) {
    return { ok: false, error: "invalid_field" };
  }
  return { ok: true, value: { title, instructions: instructions || null, interval, dueOn: fields.dueOn } };
}

/**
 * Where the task lives, as one target or (for "each unit") several. General
 * lab upkeep names no tool. A tool must still be in the lab — except, on an
 * edit, the archived tool the task already had, so an old task stays editable.
 */
async function resolveTargets(fields: Fields, keepToolId: string | null = null): Promise<Checked<Target[]>> {
  if (!fields.toolId) {
    if (fields.unitId || fields.eachUnit) return { ok: false, error: "invalid_field" };
    return { ok: true, value: [{ toolId: null, unitId: null }] };
  }
  const tool =
    keepToolId && fields.toolId === keepToolId
      ? ((await toolSubjects([keepToolId]))[0] ?? null)
      : await findActiveToolByRef(fields.toolId);
  if (!tool) return { ok: false, error: "not_found" };
  if (fields.unitId) {
    // A unit of some other machine is a mistake, not "the tool as a whole".
    const unit = await findUnitOfTool(tool.id, fields.unitId);
    return unit ? { ok: true, value: [{ toolId: tool.id, unitId: unit.id }] } : { ok: false, error: "invalid_field" };
  }
  if (fields.eachUnit) {
    const unitsOfTool = await listActiveUnitsOfTool(tool.id);
    // A tool with no units yet gets one task for the tool as a whole.
    if (unitsOfTool.length > 0) return { ok: true, value: unitsOfTool.map((unit) => ({ toolId: tool.id, unitId: unit.id })) };
  }
  return { ok: true, value: [{ toolId: tool.id, unitId: null }] };
}

function actorOf(ctx: ActionContext): ScheduleActor | null {
  const userId = ctx.identity.userId;
  return userId ? { userId, name: ctx.identity.name ?? "" } : null;
}

// ── schedules.create ───────────────────────────────────────────────

export const SCHEDULES_CREATE = defineAction<Fields, { created: number }, ScheduleWriteError>({
  id: "schedules.create",
  toolName: "create_maintenance_task",
  description:
    "Set up a recurring maintenance task for a tool, one of its units, each of its units, or general lab upkeep, repeating every N days, weeks or months.",
  permission: "maintenance.manage",
  risk: "operational",
  assistant: "never",
  neverReason: GUI_ONLY,
  input: fieldsSchema,
  invalidInput: "invalid_field",
  subject: (input) => (input.toolId ? { type: "tool", id: input.toolId } : { type: "maintenance_schedule", id: "new" }),
  check: async (input) => {
    const cleaned = clean(input, labToday());
    if (!cleaned.ok) return cleaned.error;
    const targets = await resolveTargets(input);
    return targets.ok ? null : targets.error;
  },
  run: async (input, ctx) => {
    const actor = actorOf(ctx);
    if (!actor) return { ok: false, error: "not_signed_in" };
    const cleaned = clean(input, labToday());
    if (!cleaned.ok) return cleaned;
    const targets = await resolveTargets(input);
    if (!targets.ok) return targets;
    const rows: NewSchedule[] = targets.value.map((target) => ({
      ...target,
      title: cleaned.value.title,
      instructions: cleaned.value.instructions,
      interval: cleaned.value.interval,
      firstDueOn: cleaned.value.dueOn,
    }));
    const ids = await createSchedules(rows, actor);
    return { ok: true, value: { created: ids.length }, committed: true };
  },
  revalidate: PATHS,
});

// ── schedules.update ───────────────────────────────────────────────

const updateSchema = z.object({ scheduleId: id, fields: fieldsSchema });

export const SCHEDULES_UPDATE = defineAction<z.infer<typeof updateSchema>, object, ScheduleWriteError>({
  id: "schedules.update",
  toolName: "edit_maintenance_task",
  description: "Change a recurring maintenance task: its title, instructions, where it lives, how often it repeats, or its next due date.",
  permission: "maintenance.manage",
  risk: "operational",
  assistant: "never",
  neverReason: GUI_ONLY,
  input: updateSchema,
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "maintenance_schedule", id: input.scheduleId }),
  run: async (input, ctx) => {
    const actor = actorOf(ctx);
    if (!actor) return { ok: false, error: "not_signed_in" };
    const existing = await getSchedule(input.scheduleId);
    if (!existing) return { ok: false, error: "not_found" };
    const cleaned = clean(input.fields, labToday());
    if (!cleaned.ok) return cleaned;
    // An edit changes this one task; "each unit" is a create-time choice.
    const targets = await resolveTargets({ ...input.fields, eachUnit: false }, existing.toolId);
    if (!targets.ok) return targets;
    const [target] = targets.value;
    const result = await updateSchedule(
      existing.id,
      { ...target, title: cleaned.value.title, instructions: cleaned.value.instructions, interval: cleaned.value.interval, nextDueOn: cleaned.value.dueOn },
      actor
    );
    return result.ok ? { ok: true, value: {}, committed: true } : result;
  },
  revalidate: PATHS,
});

// ── schedules.set_status ───────────────────────────────────────────

const statusSchema = z.object({ scheduleId: id, status: z.string().max(20) });

export const SCHEDULES_SET_STATUS = defineAction<z.infer<typeof statusSchema>, object, ScheduleWriteError>({
  id: "schedules.set_status",
  toolName: "set_maintenance_task_status",
  description: "Pause, resume or archive a recurring maintenance task. A paused or archived task leaves the due list; its log stays.",
  permission: "maintenance.manage",
  risk: "operational",
  assistant: "never",
  neverReason: GUI_ONLY,
  input: statusSchema,
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "maintenance_schedule", id: input.scheduleId }),
  check: async (input) => (isOneOf(SCHEDULE_STATUS, input.status) ? null : "invalid_field"),
  run: async (input, ctx) => {
    const actor = actorOf(ctx);
    if (!actor) return { ok: false, error: "not_signed_in" };
    const result = await setScheduleStatus(input.scheduleId, input.status as ScheduleStatus, actor);
    return result.ok ? { ok: true, value: {}, committed: true } : result;
  },
  revalidate: PATHS,
});

// ── schedules.complete ─────────────────────────────────────────────

const completeSchema = z.object({
  scheduleId: id,
  note: z.string().max(COMPLETION_NOTE_MAX * 2),
  expectedDueOn: z.string().max(20).nullable(),
});

export const SCHEDULES_COMPLETE = defineAction<z.infer<typeof completeSchema>, { nextDueOn: string }, ScheduleWriteError>({
  id: "schedules.complete",
  toolName: "complete_maintenance_task",
  description:
    "Check off a recurring maintenance task as done today, with an optional note. Logs who did it and moves the next due date forward by the task's interval.",
  permission: "maintenance.manage",
  risk: "operational",
  assistant: "never",
  neverReason: GUI_ONLY,
  input: completeSchema,
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "maintenance_schedule", id: input.scheduleId }),
  check: async (input) => {
    if (input.note.trim().length > COMPLETION_NOTE_MAX) return "invalid_field";
    if (input.expectedDueOn !== null && !isIsoDate(input.expectedDueOn)) return "invalid_field";
    return null;
  },
  run: async (input, ctx) => {
    const actor = actorOf(ctx);
    if (!actor) return { ok: false, error: "not_signed_in" };
    const result = await completeSchedule({
      id: input.scheduleId,
      note: input.note.trim() || null,
      expectedDueOn: input.expectedDueOn,
      today: labToday(),
      actor,
    });
    return result.ok ? { ok: true, value: { nextDueOn: result.nextDueOn }, committed: true } : result;
  },
  revalidate: PATHS,
});
