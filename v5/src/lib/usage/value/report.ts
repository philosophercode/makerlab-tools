import { GAP_KINDS, QUESTION_KINDS, type GapKind, type QuestionKind } from "../../db/schema/vocabulary.ts";
import { isStaffedHour, type ValueAssumptions } from "./assumptions.ts";
import { labClock } from "./lab-clock.ts";

/**
 * The value report's arithmetic (usage insight spec amendment "Value report"):
 * counts in, estimates out, every step one a director can say aloud. Pure —
 * the counts come from `value-queries.ts`, the assumptions from the lab.
 *
 * - **Questions answered** = assistant turns in the app + MCP questions, where
 *   MCP questions = catalogue lookups by outside assistants ÷ lookups per
 *   question (rounded down), when the lab counts MCP at all.
 * - **Handled without staff** = app turns − unanswered turns of the kinds the
 *   lab counts as unanswered (never below zero) + MCP questions. MCP has no
 *   unanswered signal, which the formula says.
 * - **Staff hours saved** = handled × minutes per question ÷ 60.
 * - **Value** = staff hours saved × loaded hourly cost.
 * - **After hours** = questions asked outside staffed hours, in lab time, ÷
 *   questions answered.
 *
 * Aggregates only: nothing here, or in what it reads, names a person.
 */

/** Questions in one UTC hour (`hour` is its ISO start). */
export interface HourlyQuestions {
  hour: string;
  chatTurns: number;
  mcpLookups: number;
}

export interface ToolCount {
  toolId: string | null;
  name: string | null;
  slug: string | null;
  asked: number;
}

/** What the database says about one period (`value-queries.ts`). */
export interface ValueCounts {
  hourly: HourlyQuestions[];
  gapsByKind: Record<GapKind, number>;
  questionKinds: Record<QuestionKind, number>;
  topTools: ToolCount[];
  citations: number;
  manualsCited: number;
  /** Unanswered questions staff filed as corrections, and how many of those are fixed. */
  unansweredFiled: number;
  unansweredFixed: number;
  /** Manuals made searchable (a `ready` manual document) in the period. */
  manualsAdded: number;
  /** Problem reports the assistant filed (chat or MCP `report_issue`), by lab date reported. */
  ticketsFiled: number;
  ticketsResolved: number;
  /** Median whole days from reported to resolved, over the resolved ones; null with none. */
  medianDaysToResolve: number | null;
}

export interface ValueMetrics {
  chatTurns: number;
  mcpLookups: number;
  mcpQuestions: number;
  questionsAnswered: number;
  unanswered: number;
  handled: number;
  /** 0–1, or null with no questions. */
  handledShare: number | null;
  staffHoursSaved: number;
  dollarValue: number;
  afterHoursQuestions: number;
  /** 0–1, or null with no questions. */
  afterHoursShare: number | null;
}

export interface ValueReport extends ValueMetrics {
  questionKinds: Record<QuestionKind, number>;
  topTools: ToolCount[];
  citations: number;
  manualsCited: number;
  unansweredFiled: number;
  unansweredFixed: number;
  manualsAdded: number;
  ticketsFiled: number;
  ticketsResolved: number;
  medianDaysToResolve: number | null;
}

export function emptyCounts(): ValueCounts {
  return {
    hourly: [],
    gapsByKind: Object.fromEntries(GAP_KINDS.map((k) => [k, 0])) as Record<GapKind, number>,
    questionKinds: Object.fromEntries(QUESTION_KINDS.map((k) => [k, 0])) as Record<QuestionKind, number>,
    topTools: [],
    citations: 0,
    manualsCited: 0,
    unansweredFiled: 0,
    unansweredFixed: 0,
    manualsAdded: 0,
    ticketsFiled: 0,
    ticketsResolved: 0,
    medianDaysToResolve: null,
  };
}

/** Questions outside staffed hours, by lab clock — MCP lookups weighted as a fraction of a question. */
export function afterHoursQuestions(hourly: HourlyQuestions[], assumptions: ValueAssumptions, timeZone: string): number {
  const perMcp = assumptions.includeMcp ? 1 / assumptions.mcpCallsPerQuestion : 0;
  let total = 0;
  for (const bucket of hourly) {
    const clock = labClock(new Date(bucket.hour), timeZone);
    if (isStaffedHour(assumptions.staffedHours, clock.dow, clock.hour)) continue;
    total += bucket.chatTurns + bucket.mcpLookups * perMcp;
  }
  return total;
}

export function computeValueReport(counts: ValueCounts, assumptions: ValueAssumptions, timeZone: string): ValueReport {
  const chatTurns = sum(counts.hourly.map((h) => h.chatTurns));
  const mcpLookups = sum(counts.hourly.map((h) => h.mcpLookups));
  const mcpQuestions = assumptions.includeMcp ? Math.floor(mcpLookups / assumptions.mcpCallsPerQuestion) : 0;
  const questionsAnswered = chatTurns + mcpQuestions;
  const unanswered = Math.min(chatTurns, sum(assumptions.unansweredKinds.map((kind) => counts.gapsByKind[kind] ?? 0)));
  const handled = chatTurns - unanswered + mcpQuestions;
  const staffHoursSaved = (handled * assumptions.minutesPerQuestion) / 60;
  const weightedTotal = chatTurns + (assumptions.includeMcp ? mcpLookups / assumptions.mcpCallsPerQuestion : 0);
  const afterWeighted = afterHoursQuestions(counts.hourly, assumptions, timeZone);
  return {
    chatTurns,
    mcpLookups,
    mcpQuestions,
    questionsAnswered,
    unanswered,
    handled,
    handledShare: questionsAnswered > 0 ? handled / questionsAnswered : null,
    staffHoursSaved,
    dollarValue: staffHoursSaved * assumptions.hourlyCost,
    afterHoursQuestions: Math.round(afterWeighted),
    afterHoursShare: weightedTotal > 0 ? afterWeighted / weightedTotal : null,
    questionKinds: counts.questionKinds,
    topTools: counts.topTools,
    citations: counts.citations,
    manualsCited: counts.manualsCited,
    unansweredFiled: counts.unansweredFiled,
    unansweredFixed: counts.unansweredFixed,
    manualsAdded: counts.manualsAdded,
    ticketsFiled: counts.ticketsFiled,
    ticketsResolved: counts.ticketsResolved,
    medianDaysToResolve: counts.medianDaysToResolve,
  };
}

export const COMPARED_METRICS = ["questionsAnswered", "handledShare", "staffHoursSaved", "dollarValue", "afterHoursShare"] as const;
export type ComparedMetric = (typeof COMPARED_METRICS)[number];

export interface MetricChange {
  current: number | null;
  previous: number | null;
  /** current − previous; null when either is missing. */
  delta: number | null;
  /** The change as a fraction of the previous value; null when there is nothing to divide by. */
  relative: number | null;
}

/** Each headline metric beside the previous period's. */
export function compareReports(current: ValueMetrics, previous: ValueMetrics): Record<ComparedMetric, MetricChange> {
  return Object.fromEntries(
    COMPARED_METRICS.map((key) => {
      const a = current[key];
      const b = previous[key];
      const delta = a !== null && b !== null ? a - b : null;
      const relative = delta !== null && b !== null && b !== 0 ? delta / Math.abs(b) : null;
      return [key, { current: a, previous: b, delta, relative }];
    })
  ) as Record<ComparedMetric, MetricChange>;
}

/** The median of whole numbers, or null for none. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
