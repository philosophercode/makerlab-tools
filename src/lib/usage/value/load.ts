import { getLabSetting, VALUE_REPORT_SETTING } from "../../data/lab-settings.ts";
import type { Db } from "../../db/types.ts";
import { resolveAssumptions, type ResolvedAssumptions } from "./assumptions.ts";
import { labClock } from "./lab-clock.ts";
import { parsePeriod, periodBounds, previousPeriod, type ReportPeriod } from "./periods.ts";
import { compareReports, computeValueReport, type ComparedMetric, type MetricChange, type ValueReport } from "./report.ts";
import { countingSince, loadValueCounts } from "./value-queries.ts";

/**
 * Everything the value report shows for one period, in one call — the page
 * (`/admin/insights/value`) and the assistant's `get_value_report` read the
 * same numbers, so a director never sees two answers to one question.
 */

export interface ValueAssumptionsState extends ResolvedAssumptions {
  updatedAt: string | null;
  updatedByName: string | null;
}

export interface ValueReportData {
  period: ReportPeriod;
  previous: ReportPeriod;
  /** True while the period has not ended: the numbers are "to date". */
  toDate: boolean;
  timeZone: string;
  today: string;
  assumptions: ValueAssumptionsState;
  report: ValueReport;
  previousReport: ValueReport;
  comparison: Record<ComparedMetric, MetricChange>;
  /** The first usage event ever counted, or null. */
  since: string | null;
}

/** The lab's assumptions: stored, else the defaults (staffed hours from the lab's hours text). */
export async function readValueAssumptions(labHoursText: string, options: { db?: Db } = {}): Promise<ValueAssumptionsState> {
  const stored = await getLabSetting(VALUE_REPORT_SETTING, options);
  return {
    ...resolveAssumptions(stored?.value, labHoursText),
    updatedAt: stored?.updatedAt ?? null,
    updatedByName: stored?.updatedByName ?? null,
  };
}

export interface LoadValueReportInput {
  /** The page's query string; `{}` for the current term. */
  search: Record<string, string | string[] | undefined>;
  timeZone: string;
  labHoursText: string;
  now?: Date;
  db?: Db;
}

export async function loadValueReport(input: LoadValueReportInput): Promise<ValueReportData> {
  const now = input.now ?? new Date();
  const options = input.db ? { db: input.db } : {};
  const assumptions = await readValueAssumptions(input.labHoursText, options);
  const terms = assumptions.assumptions.terms;
  const today = labClock(now, input.timeZone).date;
  const period = parsePeriod(input.search, terms, today);
  const previous = previousPeriod(period, terms);
  const bounds = periodBounds(period, input.timeZone, now);
  const previousBounds = periodBounds(previous, input.timeZone, now);

  const [counts, previousCounts, since] = await Promise.all([
    loadValueCounts({ start: bounds.start, end: bounds.end, from: period.from, to: period.to }, options),
    loadValueCounts({ start: previousBounds.start, end: previousBounds.end, from: previous.from, to: previous.to }, options),
    countingSince(options),
  ]);
  const report = computeValueReport(counts, assumptions.assumptions, input.timeZone);
  const previousReport = computeValueReport(previousCounts, assumptions.assumptions, input.timeZone);
  return {
    period,
    previous,
    toDate: bounds.toDate,
    timeZone: input.timeZone,
    today,
    assumptions,
    report,
    previousReport,
    comparison: compareReports(report, previousReport),
    since,
  };
}
