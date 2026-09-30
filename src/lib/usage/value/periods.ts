import { TERM_KINDS, type TermKind, type TermWindow } from "./assumptions.ts";
import { addDays, daysBetween, isIsoDate, labMidnight } from "./lab-clock.ts";

/**
 * The value report's periods: a term ("Fall 2026", from the lab's term
 * windows) or a custom date range, both as inclusive lab dates, and the period
 * before each — the term before, or the same number of days just before a
 * custom range. Pure.
 */

export type ReportPeriod =
  | { kind: "term"; term: TermKind; year: number; key: string; from: string; to: string }
  | { kind: "custom"; key: "custom"; from: string; to: string };

/** The longest custom range the report reads: a year and a day. */
export const MAX_CUSTOM_DAYS = 366;

export function termPeriod(term: TermKind, year: number, terms: TermWindow[]): ReportPeriod {
  const window = terms.find((t) => t.kind === term) ?? terms[0];
  return { kind: "term", term, year, key: `${term}-${year}`, from: `${year}-${window.start}`, to: `${year}-${window.end}` };
}

function sortedTerms(terms: TermWindow[]): TermWindow[] {
  return [...terms].sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * The term `date` falls in — or, in a gap between terms, the last one that
 * started before it (a report run over the winter break is about the fall).
 */
export function termFor(date: string, terms: TermWindow[]): ReportPeriod {
  const year = Number(date.slice(0, 4));
  const md = date.slice(5);
  const ordered = sortedTerms(terms);
  const started = ordered.filter((t) => t.start <= md);
  if (started.length > 0) return termPeriod(started[started.length - 1].kind, year, terms);
  return termPeriod(ordered[ordered.length - 1].kind, year - 1, terms);
}

/** The period before `period`: the previous term, or the same length of days just before. */
export function previousPeriod(period: ReportPeriod, terms: TermWindow[]): ReportPeriod {
  if (period.kind === "custom") {
    const length = daysBetween(period.from, period.to);
    const to = addDays(period.from, -1);
    return { kind: "custom", key: "custom", from: addDays(to, -length), to };
  }
  const ordered = sortedTerms(terms);
  const i = ordered.findIndex((t) => t.kind === period.term);
  if (i > 0) return termPeriod(ordered[i - 1].kind, period.year, terms);
  return termPeriod(ordered[ordered.length - 1].kind, period.year - 1, terms);
}

/** The terms that have started by `today`, newest first — the report's picker. */
export function recentTerms(today: string, terms: TermWindow[], count = 6): ReportPeriod[] {
  const out: ReportPeriod[] = [];
  let period = termFor(today, terms);
  while (out.length < count) {
    out.push(period);
    period = previousPeriod(period, terms);
  }
  return out;
}

/**
 * The period a query string asks for (`?term=fall-2026`, or `?from=…&to=…`),
 * else the current term. A term must be one the lab defines and not in the
 * future; a range must be real dates, forwards, at most {@link MAX_CUSTOM_DAYS}
 * long. Anything else is the current term, never an error.
 */
export function parsePeriod(search: Record<string, string | string[] | undefined>, terms: TermWindow[], today: string): ReportPeriod {
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const from = one(search.from);
  const to = one(search.to);
  if (isIsoDate(from) && isIsoDate(to) && from <= to && daysBetween(from, to) < MAX_CUSTOM_DAYS) {
    return { kind: "custom", key: "custom", from, to };
  }
  const term = one(search.term)?.match(/^(spring|summer|fall)-(\d{4})$/);
  if (term && (TERM_KINDS as readonly string[]).includes(term[1])) {
    const year = Number(term[2]);
    const period = termPeriod(term[1] as TermKind, year, terms);
    if (year >= 2000 && period.from <= today) return period;
  }
  return termFor(today, terms);
}

/** The query string for a period (the picker's links, the print URL). */
export function periodQuery(period: ReportPeriod): string {
  return period.kind === "custom" ? `from=${period.from}&to=${period.to}` : `term=${period.key}`;
}

/**
 * The instants a period covers, `[start, end)`: lab midnight on `from` to lab
 * midnight after `to`, so a DST change inside it moves nothing. `end` is
 * capped at `now` — a term that has not ended is "to date".
 */
export function periodBounds(period: Pick<ReportPeriod, "from" | "to">, timeZone: string, now: Date): { start: Date; end: Date; toDate: boolean } {
  const start = labMidnight(period.from, timeZone);
  const fullEnd = labMidnight(addDays(period.to, 1), timeZone);
  const toDate = fullEnd.getTime() > now.getTime();
  return { start, end: toDate ? new Date(Math.max(now.getTime(), start.getTime())) : fullEnd, toDate };
}
