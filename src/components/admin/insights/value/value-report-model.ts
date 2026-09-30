import { QUESTION_KINDS } from "../../../../lib/db/schema/vocabulary";
import type { StaffedHours } from "../../../../lib/usage/value/assumptions";
import { csvFileName, toCsv, type CsvRow } from "../../../../lib/usage/value/csv";
import { formatCount, formatHour, formatHours, formatLabDate, formatMinutes, formatMoney, formatPercent, formatRate } from "../../../../lib/usage/value/format";
import type { ValueReportData } from "../../../../lib/usage/value/load";
import type { ReportPeriod } from "../../../../lib/usage/value/periods";
import type { ComparedMetric, MetricChange, ValueReport } from "../../../../lib/usage/value/report";

/**
 * The value report's words and numbers, built once from the data and the
 * translations rooted at `admin.insights` — so the page, the printed page and
 * the CSV say the same thing. Directive-free and pure: the server page calls
 * it with `getTranslations`, tests with a stub.
 */

export type Translate = (key: string, values?: Record<string, string | number>) => string;

export function periodName(period: ReportPeriod, t: Translate): string {
  if (period.kind === "term") return t("value.termName", { term: period.term, year: period.year });
  return t("value.customPeriod", { from: formatLabDate(period.from), to: formatLabDate(period.to) });
}

export function reportTitle(assistant: string, period: ReportPeriod, t: Translate): string {
  return t("value.reportTitle", { assistant, period: periodName(period, t) });
}

export function staffedText(hours: StaffedHours, t: Translate): string {
  const days = [...hours.days].sort((a, b) => a - b);
  let dayText: string;
  if (days.length === 0) return t("value.staffed.none");
  if (days.length === 7) dayText = t("value.staffed.everyDay");
  else if (days.join(",") === "1,2,3,4,5") dayText = t("value.staffed.weekdays");
  else dayText = days.map((d) => t(`heatmap.days.${d}`)).join(", ");
  return t("value.staffed.range", { days: dayText, open: formatHour(hours.openHour), close: formatHour(hours.closeHour) });
}

export interface HeadlineCard {
  key: ComparedMetric;
  label: string;
  value: string;
  detail: string;
  /** "vs Summer 2026: ▲ 12" — null when there is nothing to compare. */
  change: string;
  estimate: boolean;
}

function formatMetric(key: ComparedMetric, value: number | null, t: Translate): string {
  if (value === null) return t("value.metrics.none");
  switch (key) {
    case "questionsAnswered":
      return formatCount(value);
    case "staffHoursSaved":
      return formatHours(value);
    case "dollarValue":
      return formatMoney(value);
    default:
      return formatPercent(value) ?? t("value.metrics.none");
  }
}

function formatChange(key: ComparedMetric, change: MetricChange, previousName: string, t: Translate): string {
  const label = t("value.compare.label", { period: previousName });
  if (change.previous === null || (change.previous === 0 && key !== "handledShare" && key !== "afterHoursShare")) {
    if (change.current === null || change.current === 0) return `${label}: ${t("value.compare.same")}`;
    return t("value.compare.new", { period: previousName });
  }
  if (change.delta === null || Math.abs(change.delta) < 1e-9) return `${label}: ${t("value.compare.same")}`;
  const magnitude = Math.abs(change.delta);
  let amount: string;
  if (key === "handledShare" || key === "afterHoursShare") amount = t("value.compare.points", { value: Math.round(magnitude * 100) });
  else amount = formatMetric(key, magnitude, t);
  const rel = change.relative !== null && key !== "handledShare" && key !== "afterHoursShare" ? ` (${Math.round(Math.abs(change.relative) * 100)}%)` : "";
  return `${label}: ${t(change.delta > 0 ? "value.compare.up" : "value.compare.down", { change: `${amount}${rel}` })}`;
}

export function headlineCards(data: ValueReportData, t: Translate): HeadlineCard[] {
  const r = data.report;
  const a = data.assumptions.assumptions;
  const previousName = periodName(data.previous, t);
  const details: Record<ComparedMetric, string> = {
    questionsAnswered: t("value.metrics.questionsDetail", { app: formatCount(r.chatTurns), mcp: formatCount(r.mcpQuestions) }),
    handledShare: t("value.metrics.handledDetail", { handled: formatCount(r.handled), total: formatCount(r.questionsAnswered) }),
    staffHoursSaved: t("value.metrics.hoursDetail", { minutes: formatMinutes(a.minutesPerQuestion) }),
    dollarValue: t("value.metrics.valueDetail", { cost: formatRate(a.hourlyCost) }),
    afterHoursShare: t("value.metrics.afterDetail", { count: formatCount(r.afterHoursQuestions) }),
  };
  const estimates: ComparedMetric[] = ["staffHoursSaved", "dollarValue"];
  return (Object.keys(details) as ComparedMetric[]).map((key) => ({
    key,
    label: t(`value.metrics.${key}`),
    value: formatMetric(key, r[key], t),
    detail: details[key],
    change: formatChange(key, data.comparison[key], previousName, t),
    estimate: estimates.includes(key),
  }));
}

/** The formulas in plain words, with this period's numbers in them. */
export function formulaLines(data: ValueReportData, t: Translate): string[] {
  const r = data.report;
  const a = data.assumptions.assumptions;
  const kinds = a.unansweredKinds.length > 0 ? a.unansweredKinds.map((k) => t(`gaps.kind.${k}`).toLowerCase()).join(", ") : t("value.formulas.noKinds");
  const share = formatPercent(r.handledShare) ?? t("value.metrics.none");
  const common = { app: formatCount(r.chatTurns), unanswered: formatCount(r.unanswered), kinds, handled: formatCount(r.handled), share };
  return [
    a.includeMcp
      ? t("value.formulas.questions", {
          app: formatCount(r.chatTurns),
          mcp: formatCount(r.mcpQuestions),
          lookups: formatCount(r.mcpLookups),
          perQuestion: a.mcpCallsPerQuestion,
          total: formatCount(r.questionsAnswered),
        })
      : t("value.formulas.questionsNoMcp", { app: formatCount(r.chatTurns), lookups: formatCount(r.mcpLookups) }),
    a.includeMcp ? t("value.formulas.handled", { ...common, mcp: formatCount(r.mcpQuestions) }) : t("value.formulas.handledNoMcp", common),
    t("value.formulas.hours", { handled: formatCount(r.handled), minutes: formatMinutes(a.minutesPerQuestion), hours: formatHours(r.staffHoursSaved) }),
    t("value.formulas.value", { hours: formatHours(r.staffHoursSaved), cost: formatRate(a.hourlyCost), value: formatMoney(r.dollarValue) }),
    t("value.formulas.afterHours", {
      after: formatCount(r.afterHoursQuestions),
      total: formatCount(r.questionsAnswered),
      staffed: staffedText(a.staffedHours, t),
      timeZone: data.timeZone,
      share: formatPercent(r.afterHoursShare) ?? t("value.metrics.none"),
    }),
  ];
}

export interface BreakdownRow {
  key: string;
  label: string;
  value: string;
}

export function followUpRows(r: ValueReport, t: Translate): BreakdownRow[] {
  return [
    { key: "citations", label: t("value.breakdown.citations"), value: formatCount(r.citations) },
    { key: "manualsCited", label: t("value.breakdown.manualsCited"), value: formatCount(r.manualsCited) },
    { key: "unansweredFiled", label: t("value.breakdown.unansweredFiled"), value: formatCount(r.unansweredFiled) },
    { key: "unansweredFixed", label: t("value.breakdown.unansweredFixed"), value: formatCount(r.unansweredFixed) },
    { key: "manualsAdded", label: t("value.breakdown.manualsAdded"), value: formatCount(r.manualsAdded) },
    { key: "ticketsFiled", label: t("value.breakdown.ticketsFiled"), value: formatCount(r.ticketsFiled) },
    { key: "ticketsResolved", label: t("value.breakdown.ticketsResolved"), value: formatCount(r.ticketsResolved) },
    {
      key: "medianDays",
      label: t("value.breakdown.medianDays"),
      value: r.medianDaysToResolve === null ? t("value.metrics.none") : t("value.breakdown.medianDaysValue", { days: Math.round(r.medianDaysToResolve * 10) / 10 }),
    },
  ];
}

export function kindRows(r: ValueReport, t: Translate): BreakdownRow[] {
  const total = QUESTION_KINDS.reduce((sum, k) => sum + r.questionKinds[k], 0);
  return QUESTION_KINDS.map((k) => ({
    key: k,
    label: t(`kinds.${k}`),
    value: total > 0 ? `${formatCount(r.questionKinds[k])} (${formatPercent(r.questionKinds[k] / total)})` : formatCount(r.questionKinds[k]),
  }));
}

export function toolRows(r: ValueReport, t: Translate): BreakdownRow[] {
  return r.topTools.map((tool, i) => ({
    key: tool.toolId ?? `deleted-${i}`,
    label: tool.name ?? t("value.breakdown.deletedTool"),
    value: t("value.breakdown.toolAsked", { count: tool.asked }),
  }));
}

/** The assumptions line under the report, printed with it. */
export function assumptionsLine(data: ValueReportData, t: Translate): string {
  const a = data.assumptions.assumptions;
  return t("value.assumptionsLine", {
    minutes: formatMinutes(a.minutesPerQuestion),
    cost: formatRate(a.hourlyCost),
    staffed: staffedText(a.staffedHours, t),
    timeZone: data.timeZone,
  });
}

/** Everything the printed page shows, as words — what `ValueReportView` renders. */
export interface ValueReportViewModel {
  title: string;
  labName: string;
  dates: string;
  since: string | null;
  cards: HeadlineCard[];
  formulas: string[];
  tools: BreakdownRow[];
  kinds: BreakdownRow[];
  followUp: BreakdownRow[];
  assumptions: string;
  assumptionsState: string | null;
}

export function valueReportViewModel(data: ValueReportData, t: Translate, brand: { assistant: string; labName: string }): ValueReportViewModel {
  const title = reportTitle(brand.assistant, data.period, t);
  const range = t("value.dates", { from: formatLabDate(data.period.from), to: formatLabDate(data.period.to) });
  const dates = data.toDate ? `${range} · ${t("value.toDate", { today: formatLabDate(data.today) })}` : range;
  const sinceDate = data.since ? data.since.slice(0, 10) : null;
  const state = data.assumptions;
  const changed = state.updatedAt
    ? state.updatedByName
      ? t("value.assumptionsChanged", { date: formatLabDate(state.updatedAt.slice(0, 10)), name: state.updatedByName })
      : t("value.assumptionsChangedNoName", { date: formatLabDate(state.updatedAt.slice(0, 10)) })
    : null;
  const assumptionsState = state.origin === "invalid" ? t("value.assumptionsInvalid") : state.origin === "default" ? t("value.assumptionsDefault") : changed;
  return {
    title,
    labName: brand.labName,
    dates,
    since: sinceDate && sinceDate > data.period.from ? t("value.since", { date: formatLabDate(sinceDate) }) : null,
    cards: headlineCards(data, t),
    formulas: formulaLines(data, t),
    tools: toolRows(data.report, t),
    kinds: kindRows(data.report, t),
    followUp: followUpRows(data.report, t),
    assumptions: assumptionsLine(data, t),
    assumptionsState,
  };
}

/** The CSV: every headline, breakdown and assumption, this period and the previous one. */
export function valueReportCsv(data: ValueReportData, title: string, t: Translate): { fileName: string; csv: string } {
  const r = data.report;
  const p = data.previousReport;
  const a = data.assumptions.assumptions;
  const current = periodName(data.period, t);
  const previous = periodName(data.previous, t);
  const pct = (share: number | null) => formatPercent(share) ?? "";
  const rows: CsvRow[] = [
    { section: "Report", metric: "Title", current: title },
    { section: "Report", metric: "Period", current: `${data.period.from} to ${data.period.to}`, previous: `${data.previous.from} to ${data.previous.to}`, note: data.toDate ? `to date, through ${data.today}` : "" },
    { section: "Headline", metric: t("value.metrics.questionsAnswered"), current: r.questionsAnswered, previous: p.questionsAnswered },
    { section: "Headline", metric: "Questions in the app", current: r.chatTurns, previous: p.chatTurns },
    { section: "Headline", metric: "MCP catalogue lookups", current: r.mcpLookups, previous: p.mcpLookups },
    { section: "Headline", metric: "MCP questions", current: r.mcpQuestions, previous: p.mcpQuestions, note: a.includeMcp ? `lookups / ${a.mcpCallsPerQuestion}, rounded down` : "not counted" },
    { section: "Headline", metric: "Could not answer", current: r.unanswered, previous: p.unanswered },
    { section: "Headline", metric: "Handled without staff", current: r.handled, previous: p.handled },
    { section: "Headline", metric: t("value.metrics.handledShare"), current: pct(r.handledShare), previous: pct(p.handledShare) },
    { section: "Headline", metric: "Staff hours saved (estimate)", current: formatHours(r.staffHoursSaved), previous: formatHours(p.staffHoursSaved), note: `handled x ${a.minutesPerQuestion} min / 60` },
    { section: "Headline", metric: "Estimated value (USD)", current: Math.round(r.dollarValue), previous: Math.round(p.dollarValue), note: `hours x ${a.hourlyCost} per hour` },
    { section: "Headline", metric: "Questions outside staffed hours", current: r.afterHoursQuestions, previous: p.afterHoursQuestions },
    { section: "Headline", metric: t("value.metrics.afterHoursShare"), current: pct(r.afterHoursShare), previous: pct(p.afterHoursShare) },
    ...QUESTION_KINDS.map((k) => ({ section: "Question kinds", metric: t(`kinds.${k}`), current: r.questionKinds[k], previous: p.questionKinds[k] })),
    ...r.topTools.map((tool, i) => ({ section: "Most asked-about tools", metric: `${i + 1}. ${tool.name ?? t("value.breakdown.deletedTool")}`, current: tool.asked })),
    { section: "Follow-up", metric: t("value.breakdown.citations"), current: r.citations, previous: p.citations },
    { section: "Follow-up", metric: t("value.breakdown.manualsCited"), current: r.manualsCited, previous: p.manualsCited },
    { section: "Follow-up", metric: t("value.breakdown.unansweredFiled"), current: r.unansweredFiled, previous: p.unansweredFiled },
    { section: "Follow-up", metric: "Unanswered filed and fixed", current: r.unansweredFixed, previous: p.unansweredFixed },
    { section: "Follow-up", metric: t("value.breakdown.manualsAdded"), current: r.manualsAdded, previous: p.manualsAdded },
    { section: "Follow-up", metric: t("value.breakdown.ticketsFiled"), current: r.ticketsFiled, previous: p.ticketsFiled },
    { section: "Follow-up", metric: "Problem reports resolved", current: r.ticketsResolved, previous: p.ticketsResolved },
    { section: "Follow-up", metric: t("value.breakdown.medianDays"), current: r.medianDaysToResolve, previous: p.medianDaysToResolve },
    { section: "Assumptions", metric: "Minutes of staff time per question", current: a.minutesPerQuestion },
    { section: "Assumptions", metric: "Loaded staff cost per hour (USD)", current: a.hourlyCost },
    { section: "Assumptions", metric: "Staffed hours", current: staffedText(a.staffedHours, t), note: data.timeZone },
    { section: "Assumptions", metric: "Not handled without staff", current: a.unansweredKinds.join(" ") },
    { section: "Assumptions", metric: "MCP lookups per question", current: a.includeMcp ? a.mcpCallsPerQuestion : "not counted" },
  ];
  const csv = toCsv(["Section", "Metric", current, previous, "Note"], rows);
  return { fileName: csvFileName(title), csv };
}
