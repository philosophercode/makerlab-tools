/**
 * Lab-time arithmetic for the value report: what day and hour an instant is in
 * the lab's timezone, and which instant a lab date starts at. `Intl` rather
 * than fixed offsets, because the offset depends on the date (daylight saving)
 * and only the runtime's timezone database knows it — the same reason
 * `lib/lab-time.ts` gives. Pure.
 */

const clockFormats = new Map<string, Intl.DateTimeFormat>();

function clockFormat(timeZone: string): Intl.DateTimeFormat {
  let fmt = clockFormats.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    clockFormats.set(timeZone, fmt);
  }
  return fmt;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export interface LabClock {
  /** `YYYY-MM-DD` in lab time. */
  date: string;
  /** 0 = Sunday. */
  dow: number;
  /** 0–23. */
  hour: number;
}

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  dow: number;
}

function partsOf(instant: Date, timeZone: string): Parts {
  const out: Record<string, string> = {};
  for (const part of clockFormat(timeZone).formatToParts(instant)) out[part.type] = part.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    // Some ICU builds render midnight as "24" even with h23.
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
    dow: WEEKDAYS[out.weekday] ?? 0,
  };
}

/** The lab's date, weekday and hour at `instant`. */
export function labClock(instant: Date, timeZone: string): LabClock {
  const p = partsOf(instant, timeZone);
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, dow: p.dow, hour: p.hour };
}

/** The lab's offset from UTC at `instant`, in milliseconds (New York in summer: −4 h). */
export function labOffsetMs(instant: Date, timeZone: string): number {
  const p = partsOf(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant a lab date (`YYYY-MM-DD`) begins: its 00:00 in lab time. Two
 * passes, because the offset at a UTC guess can differ from the offset at the
 * answer on a DST changeover day.
 */
export function labMidnight(date: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let at = guess - labOffsetMs(new Date(guess), timeZone);
  at = guess - labOffsetMs(new Date(at), timeZone);
  return new Date(at);
}

/** `YYYY-MM-DD` + `days` (negative to go back), calendar arithmetic with no timezone. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Whole days from `from` to `to` (both `YYYY-MM-DD`): 0 for the same day. */
export function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** A real calendar date in `YYYY-MM-DD` form. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return addDays(value, 0) === value;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
