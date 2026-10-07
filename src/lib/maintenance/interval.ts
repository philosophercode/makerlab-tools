import type { ScheduleIntervalUnit } from "../db/schema/vocabulary.ts";

/**
 * The date maths of recurring maintenance (recurring maintenance spec §4, §5;
 * amendment 2026-10-06). Pure: every function takes and returns lab dates as
 * `YYYY-MM-DD` strings, the shape a Postgres `date` column has.
 *
 * **Calendar dates, never instants.** "Today" comes from `labToday()` (the
 * lab's timezone) and is passed in. Everything after that is arithmetic on
 * calendar days in UTC, where no day is 23 or 25 hours long, so daylight
 * saving cannot move a due date.
 *
 * Relative imports with `.ts` and no `"server-only"`: `src/lib/data` imports
 * this, and `scripts/` loads those modules under plain Node.
 */

export interface ScheduleInterval {
  count: number;
  unit: ScheduleIntervalUnit;
}

/** The longest interval a schedule may have, in its own units (the table's CHECK). */
export const INTERVAL_COUNT_MAX = 730;

/** How far ahead "due soon" looks: the due list shows a week. */
export const DUE_SOON_DAYS = 7;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** True when `value` is a real calendar date written `YYYY-MM-DD` (no 2026-02-30). */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** True when `interval` is one a schedule may hold. */
export function isValidInterval(interval: { count: unknown; unit: unknown }): interval is ScheduleInterval {
  return (
    Number.isInteger(interval.count) &&
    (interval.count as number) >= 1 &&
    (interval.count as number) <= INTERVAL_COUNT_MAX &&
    (interval.unit === "day" || interval.unit === "week" || interval.unit === "month")
  );
}

function toUtc(iso: string): Date {
  if (!isIsoDate(iso)) throw new RangeError(`not a YYYY-MM-DD date: ${iso}`);
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The last day of a month (`month` 0-based), in UTC. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * `iso` moved forward by `interval`. A month step keeps the day of the month
 * and clamps it to the month's end: 31 January + 1 month is 28 February (29
 * in a leap year), and 31 August + 1 month is 30 September.
 */
export function addInterval(iso: string, interval: ScheduleInterval): string {
  if (!isValidInterval(interval)) throw new RangeError(`not a schedule interval: ${JSON.stringify(interval)}`);
  const start = toUtc(iso);
  if (interval.unit === "day") return fromUtc(new Date(start.getTime() + interval.count * DAY_MS));
  if (interval.unit === "week") return fromUtc(new Date(start.getTime() + interval.count * 7 * DAY_MS));
  const totalMonths = start.getUTCMonth() + interval.count;
  const year = start.getUTCFullYear() + Math.floor(totalMonths / 12);
  const month = totalMonths % 12;
  const day = Math.min(start.getUTCDate(), daysInMonth(year, month));
  return fromUtc(new Date(Date.UTC(year, month, day)));
}

/** Whole days from `from` to `to`: positive when `to` is later. */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / DAY_MS);
}

/** How many days late a task due on `dueOn` is on `today`: 0 on the due day and before it. */
export function overdueDays(dueOn: string, today: string): number {
  return Math.max(0, daysBetween(dueOn, today));
}

/**
 * Where a due date stands on `today`:
 *
 * - `overdue` — the due day has passed;
 * - `today` — it is due today;
 * - `soon` — due within the next {@link DUE_SOON_DAYS} days (or `soonDays`);
 * - `later` — further out.
 */
export type DueState = "overdue" | "today" | "soon" | "later";

export function dueState(dueOn: string, today: string, soonDays: number = DUE_SOON_DAYS): DueState {
  const ahead = daysBetween(today, dueOn);
  if (ahead < 0) return "overdue";
  if (ahead === 0) return "today";
  return ahead <= soonDays ? "soon" : "later";
}

/**
 * The next due date once a task is checked off on `doneOn`. **Floating**
 * (spec §13 Q1): the interval counts from the day the work was done, so a
 * weekly task done three days late is next due a week after that, not in four
 * days. A task done early moves forward from the early day too.
 */
export function nextDueAfterDone(doneOn: string, interval: ScheduleInterval): string {
  return addInterval(doneOn, interval);
}
