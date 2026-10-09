"use server";

import {
  SCHEDULES_COMPLETE,
  SCHEDULES_CREATE,
  SCHEDULES_SET_STATUS,
  SCHEDULES_UPDATE,
} from "../../../lib/actions/maintenance-schedules";
import { performAction } from "../../../lib/actions/perform";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import type {
  CompleteScheduleActionResult,
  CreateScheduleResult,
  ScheduleActionResult,
  ScheduleFields,
} from "./schedule-result";

/**
 * Recurring maintenance (recurring maintenance spec, amendment 2026-10-06) —
 * one-line wrappers over the `schedules.*` definitions
 * (`src/lib/actions/maintenance-schedules.ts`). Each checks
 * `maintenance.manage` itself through `performAction`: a server action is a
 * POST endpoint reachable without the page that renders it.
 */

export async function createSchedule(input: ScheduleFields): Promise<CreateScheduleResult> {
  return performAction(SCHEDULES_CREATE, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}

export async function editSchedule(input: { scheduleId: string; fields: ScheduleFields }): Promise<ScheduleActionResult> {
  return performAction(SCHEDULES_UPDATE, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}

export async function setScheduleStatus(input: { scheduleId: string; status: string }): Promise<ScheduleActionResult> {
  return performAction(SCHEDULES_SET_STATUS, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}

export async function completeSchedule(input: {
  scheduleId: string;
  note: string;
  expectedDueOn: string | null;
}): Promise<CompleteScheduleActionResult> {
  return performAction(SCHEDULES_COMPLETE, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}
