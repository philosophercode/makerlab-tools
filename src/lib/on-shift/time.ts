import { labTimezone } from "../lab-time.ts";

/**
 * When a shift ends (on-shift spec 2026-10-07 §5): a time of day, picked by
 * the staff member, **today in the lab's timezone** (`LAB_TIMEZONE`). The
 * server turns "18:00" into an instant; the browser's own timezone never
 * enters into it, so a laptop still set to another city cannot put somebody
 * on shift until the wrong hour.
 *
 * Pure and universal: the action validates with it and the form shows the
 * default. No `@/` alias: `src/lib/data/*` may import it.
 */

/** "HH:MM" on a 24-hour clock, what `<input type="time">` sends. */
export const SHIFT_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** The default end: the end of today, in lab time. */
export const DEFAULT_SHIFT_END = "23:59";

/**
 * The instant `hhmm` names today in `timeZone`, or null when `hhmm` is not a
 * time. "Today" is the lab's date at `now`. A timezone `Intl` does not know
 * falls back to UTC, like `labToday`: a typo in an environment variable must
 * not stop staff marking themselves on shift.
 */
export function labTimeToday(hhmm: string, now: Date = new Date(), timeZone: string = labTimezone()): Date | null {
  const match = SHIFT_TIME_PATTERN.exec(hhmm);
  if (!match) return null;
  const zone = knownZone(timeZone);
  const { year, month, day } = wallClock(now, zone);
  const wall = Date.UTC(year, month - 1, day, Number(match[1]), Number(match[2]));
  // The zone's offset depends on the date (daylight saving), so guess with
  // the offset at the wall time read as UTC, then correct with the offset at
  // the guess. Two steps settle every real timezone.
  const guess = wall - offsetAt(new Date(wall), zone);
  return new Date(wall - offsetAt(new Date(guess), zone));
}

/** `instant` as "HH:MM" on the lab's clock: what the form shows for a shift already set. */
export function labClockTime(instant: Date | string, timeZone: string = labTimezone()): string {
  const { hour, minute } = wallClock(typeof instant === "string" ? new Date(instant) : instant, knownZone(timeZone));
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** True while a shift that ends at `endsAt` is still on at `now`. */
export function isShiftOn(endsAt: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (!endsAt) return false;
  const ends = typeof endsAt === "string" ? Date.parse(endsAt) : endsAt.getTime();
  return Number.isFinite(ends) && ends > now.getTime();
}

/** `timeZone` when `Intl` knows it, else UTC. */
export function knownZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    console.warn(`[on-shift] LAB_TIMEZONE="${timeZone}" is not a timezone Intl recognises; using UTC.`);
    return "UTC";
  }
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClock(instant: Date, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute"), second: get("second") };
}

/** The zone's offset from UTC at `instant`, in milliseconds (wall clock minus UTC). */
function offsetAt(instant: Date, timeZone: string): number {
  const wall = wallClock(instant, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}
