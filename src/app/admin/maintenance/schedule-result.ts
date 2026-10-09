import type { AdminActionWarning, AdminGateError } from "../../../lib/admin/action-result";

/**
 * What the recurring-task actions answer, and the paths they refresh
 * (recurring maintenance spec, amendment 2026-10-06). Their own module with no
 * directive, like every admin surface's: a `"use server"` module may export
 * only async functions, and the client islands render these codes without
 * pulling `next/headers` into their graph.
 */

/** Where recurring tasks are set up. */
export const SCHEDULES_PATH = "/admin/maintenance/schedules";

/**
 * The Shift checklist, where the tasks due are checked off (admin sections
 * spec 2026-10-07). The overview (`/admin`) shows the same list.
 */
export const CHECKLIST_PATH = "/admin/maintenance/checklist";

/**
 * Why a recurring-task write did not land. Every code has an
 * `admin.errors.<code>` message.
 *
 * - `not_found` — the task (or the tool or unit it names) is gone.
 * - `invalid_field` — a value outside what the form allows: an empty title, an
 *   interval out of range, a date that is not a date, a unit of another tool.
 * - `conflict` — **Done** on a task somebody else already checked off, paused
 *   or edited since the page loaded. Nothing is logged twice.
 */
export type ScheduleWriteError = "not_found" | "invalid_field" | "conflict";

export type ScheduleActionError = AdminGateError | ScheduleWriteError;

/** What the form sends to create a task, or to edit one (`eachUnit` is ignored on edit). */
export interface ScheduleFields {
  title: string;
  instructions: string;
  /** A tool's id, or null for general lab upkeep. */
  toolId: string | null;
  /** One unit's id, or null for the tool as a whole (or for each unit). */
  unitId: string | null;
  /** Create one task per active unit of the tool. */
  eachUnit: boolean;
  intervalCount: number;
  /** One of `SCHEDULE_INTERVAL_UNIT`. */
  intervalUnit: string;
  /** `YYYY-MM-DD`: the first due date when creating, the next one when editing. */
  dueOn: string;
}

export type CreateScheduleResult =
  | { ok: true; created: number; warning?: AdminActionWarning }
  | { ok: false; error: ScheduleActionError };

export type ScheduleActionResult = { ok: true; warning?: AdminActionWarning } | { ok: false; error: ScheduleActionError };

export type CompleteScheduleActionResult =
  | { ok: true; nextDueOn: string; warning?: AdminActionWarning }
  | { ok: false; error: ScheduleActionError };

export type CreateScheduleAction = (input: ScheduleFields) => Promise<CreateScheduleResult>;
export type UpdateScheduleAction = (input: { scheduleId: string; fields: ScheduleFields }) => Promise<ScheduleActionResult>;
export type SetScheduleStatusAction = (input: { scheduleId: string; status: string }) => Promise<ScheduleActionResult>;
export type CompleteScheduleAction = (input: {
  scheduleId: string;
  note: string;
  expectedDueOn: string | null;
}) => Promise<CompleteScheduleActionResult>;
