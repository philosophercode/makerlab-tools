import { z } from "zod";
import { GAP_KINDS, type GapKind } from "../../db/schema/vocabulary.ts";

/**
 * The lab-set assumptions behind the value report (usage insight spec
 * amendment "Value report"). Every number the report turns into hours and
 * dollars is one of these, shown beside the result and editable by an admin —
 * the report is an **estimate**, and a director defending it to a dean has to
 * be able to say where each number came from.
 *
 * Pure and directive-free: the page, the island, the action and the
 * assistant's read all share it. Stored as JSON in `lab_settings`
 * (`value_report`), always re-validated on the way out.
 */

export const TERM_KINDS = ["spring", "summer", "fall"] as const;
export type TermKind = (typeof TERM_KINDS)[number];

/** One academic term, as a month-day window repeated every year (`MM-DD`, inclusive). */
export interface TermWindow {
  kind: TermKind;
  start: string;
  end: string;
}

/** When staff are in the lab, in lab time: whole hours, `closeHour` exclusive. */
export interface StaffedHours {
  /** Days of the week staff are in, 0 = Sunday. */
  days: number[];
  /** 0–23. */
  openHour: number;
  /** 1–24, after `openHour`. */
  closeHour: number;
}

export interface ValueAssumptions {
  /** Minutes of staff time one question would otherwise take. */
  minutesPerQuestion: number;
  /** Loaded staff cost per hour, in dollars. */
  hourlyCost: number;
  staffedHours: StaffedHours;
  /** One window per term kind, not overlapping. */
  terms: TermWindow[];
  /** Unanswered kinds that do **not** count as handled without staff. */
  unansweredKinds: GapKind[];
  /** Count questions asked through MCP (outside assistants) as well as in the app. */
  includeMcp: boolean;
  /** How many MCP catalogue lookups make one question (an outside assistant searches, then reads). */
  mcpCallsPerQuestion: number;
}

export const DEFAULT_MINUTES_PER_QUESTION = 4;
export const DEFAULT_HOURLY_COST = 40;
export const DEFAULT_MCP_CALLS_PER_QUESTION = 2;

/**
 * Default terms: contiguous, so every day of the year belongs to one and
 * "the previous term" always exists. Spring runs through the winter break's
 * end, fall through the new year's eve. A lab edits them to its calendar.
 */
export const DEFAULT_TERMS: TermWindow[] = [
  { kind: "spring", start: "01-01", end: "05-20" },
  { kind: "summer", start: "05-21", end: "08-20" },
  { kind: "fall", start: "08-21", end: "12-31" },
];

export const FALLBACK_STAFFED_HOURS: StaffedHours = { days: [0, 1, 2, 3, 4, 5, 6], openHour: 8, closeHour: 20 };

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

function to24(hour: number, meridiem: string | undefined): number {
  if (!meridiem) return hour;
  const pm = meridiem.toLowerCase() === "pm";
  if (hour === 12) return pm ? 12 : 0;
  return pm ? hour + 12 : hour;
}

/**
 * Staffed hours from the lab's one-line hours text (`siteConfig.labHours`,
 * `NEXT_PUBLIC_LAB_HOURS`, e.g. "LAB OPEN 8AM-8PM"): the first time range it
 * names, 12- or 24-hour, rounded out to whole hours; weekdays only when the
 * text says so ("Mon–Fri", "weekdays"). Anything unreadable is 8 AM–8 PM,
 * every day.
 */
export function staffedHoursFromText(text: string | null | undefined): StaffedHours {
  const source = (text ?? "").trim();
  const range = source.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!range) return { ...FALLBACK_STAFFED_HOURS, days: [...FALLBACK_STAFFED_HOURS.days] };
  const [, openText, , openMeridiem, closeText, closeMinutes, closeMeridiem] = range;
  let closeHour = to24(Number(closeText), closeMeridiem);
  // A bare first hour takes the second's meridiem when that keeps the range
  // forwards ("1-5PM" is 1 PM–5 PM) and is morning otherwise ("8-8PM", "9-5PM").
  let openHour = to24(Number(openText), openMeridiem);
  if (!openMeridiem && closeMeridiem && to24(Number(openText), closeMeridiem) < closeHour) {
    openHour = to24(Number(openText), closeMeridiem);
  }
  // Rounded out to whole hours: 8:30 PM closes at 9 PM.
  if (closeMinutes && Number(closeMinutes) > 0) closeHour += 1;
  if (closeHour === 0) closeHour = 24;
  const weekdays = /\b(mon(day)?\s*(?:-|–|—|to)\s*fri(day)?|weekdays?|m\s*-\s*f)\b/i.test(source);
  const days = weekdays ? [1, 2, 3, 4, 5] : [...ALL_DAYS];
  if (!(openHour >= 0 && openHour < 24 && closeHour > openHour && closeHour <= 24)) {
    return { ...FALLBACK_STAFFED_HOURS, days };
  }
  return { days, openHour, closeHour };
}

/** The defaults, with staffed hours from the lab's hours text. */
export function defaultAssumptions(labHoursText?: string | null): ValueAssumptions {
  return {
    minutesPerQuestion: DEFAULT_MINUTES_PER_QUESTION,
    hourlyCost: DEFAULT_HOURLY_COST,
    staffedHours: staffedHoursFromText(labHoursText),
    terms: DEFAULT_TERMS.map((term) => ({ ...term })),
    unansweredKinds: [...GAP_KINDS],
    includeMcp: true,
    mcpCallsPerQuestion: DEFAULT_MCP_CALLS_PER_QUESTION,
  };
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** A real `MM-DD` in every year (so never 02-29). */
export function isMonthDay(value: string): boolean {
  const m = /^(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const month = Number(m[1]);
  const day = Number(m[2]);
  return month >= 1 && month <= 12 && day >= 1 && day <= DAYS_IN_MONTH[month - 1];
}

const monthDay = z.string().refine(isMonthDay, "not_a_date");

const termSchema = z.object({ kind: z.enum(TERM_KINDS), start: monthDay, end: monthDay }).refine((t) => t.start <= t.end, "term_backwards");

export const valueAssumptionsSchema = z
  .object({
    minutesPerQuestion: z.number().finite().min(0.5).max(60),
    hourlyCost: z.number().finite().min(0).max(1000),
    staffedHours: z
      .object({
        days: z.array(z.number().int().min(0).max(6)).max(7),
        openHour: z.number().int().min(0).max(23),
        closeHour: z.number().int().min(1).max(24),
      })
      .refine((h) => h.closeHour > h.openHour, "hours_backwards"),
    terms: z.array(termSchema).length(TERM_KINDS.length),
    unansweredKinds: z.array(z.enum(GAP_KINDS)).max(GAP_KINDS.length),
    includeMcp: z.boolean(),
    mcpCallsPerQuestion: z.number().int().min(1).max(10),
  })
  .refine((a) => new Set(a.terms.map((t) => t.kind)).size === TERM_KINDS.length, "terms_incomplete")
  .refine((a) => !termsOverlap(a.terms), "terms_overlap");

function termsOverlap(terms: TermWindow[]): boolean {
  const sorted = [...terms].sort((a, b) => a.start.localeCompare(b.start));
  return sorted.some((term, i) => i > 0 && term.start <= sorted[i - 1].end);
}

/** Canonical order and no duplicates, so two equal settings store the same JSON. */
export function normalizeAssumptions(a: ValueAssumptions): ValueAssumptions {
  return {
    ...a,
    staffedHours: { ...a.staffedHours, days: [...new Set(a.staffedHours.days)].sort((x, y) => x - y) },
    terms: [...a.terms].sort((x, y) => x.start.localeCompare(y.start)).map((t) => ({ kind: t.kind, start: t.start, end: t.end })),
    unansweredKinds: GAP_KINDS.filter((kind) => a.unansweredKinds.includes(kind)),
  };
}

export interface ResolvedAssumptions {
  assumptions: ValueAssumptions;
  /** "stored" — the lab set them; "default" — nothing stored; "invalid" — a stored value no longer parses. */
  origin: "stored" | "default" | "invalid";
}

/**
 * What the report runs on: the stored value when it parses (fields it lacks
 * taken from the defaults, so a setting added later needs no migration), else
 * the defaults. Never throws.
 */
export function resolveAssumptions(stored: unknown, labHoursText?: string | null): ResolvedAssumptions {
  const defaults = defaultAssumptions(labHoursText);
  if (stored === null || stored === undefined) return { assumptions: defaults, origin: "default" };
  if (typeof stored !== "object" || Array.isArray(stored)) return { assumptions: defaults, origin: "invalid" };
  const parsed = valueAssumptionsSchema.safeParse({ ...defaults, ...(stored as Record<string, unknown>) });
  return parsed.success ? { assumptions: normalizeAssumptions(parsed.data), origin: "stored" } : { assumptions: defaults, origin: "invalid" };
}

/** True when `hour` (0–23) on `dow` (0 = Sunday), in lab time, is staffed. */
export function isStaffedHour(hours: StaffedHours, dow: number, hour: number): boolean {
  return hours.days.includes(dow) && hour >= hours.openHour && hour < hours.closeHour;
}
