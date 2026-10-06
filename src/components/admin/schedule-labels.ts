import type { ScheduleView } from "../../lib/data/maintenance-schedules";
import { daysBetween, dueState, overdueDays, type DueState, type ScheduleInterval } from "../../lib/maintenance/interval";
import type { StatusTone } from "../system/StatusGlyph";

/**
 * The words a recurring task is shown with (recurring maintenance spec,
 * amendment 2026-10-06), shared by the due list on `/admin/maintenance` and
 * the task list on `/admin/maintenance/schedules`. Pure: the caller passes its
 * translator (`admin.schedules`) and the lab's today, so this is testable
 * without a request and identical on the server and the client.
 */

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** "Every week", "Every 3 months". */
export function everyLabel(t: Translate, interval: ScheduleInterval): string {
  return t(`every.${interval.unit}`, { count: interval.count });
}

/** "Laser cutter · Unit B", "Laser cutter", or "General lab upkeep". */
export function whereLabel(t: Translate, schedule: Pick<ScheduleView, "toolName" | "unitLabel">): string {
  if (!schedule.toolName) return t("general");
  return schedule.unitLabel ? `${schedule.toolName} · ${schedule.unitLabel}` : schedule.toolName;
}

/** The glyph tone a due state is shown in: overdue is bad, today waits on you. */
export const DUE_TONE: Record<DueState, StatusTone> = {
  overdue: "bad",
  today: "active",
  soon: "warn",
  later: "idle",
};

/** "3 days overdue", "Due today", "Due tomorrow", "Due in 20 days". The date itself is on the meta line. */
export function dueLabel(t: Translate, dueOn: string, today: string): { state: DueState; text: string } {
  const state = dueState(dueOn, today);
  if (state === "overdue") return { state, text: t("state.overdue", { count: overdueDays(dueOn, today) }) };
  if (state === "today") return { state, text: t("state.today") };
  return { state, text: t("state.ahead", { count: daysBetween(today, dueOn) }) };
}
