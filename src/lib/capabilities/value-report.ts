import { z } from "zod";
import { labTimezone } from "../lab-time";
import { siteConfig } from "../site-config";
import { formatHour, formatHours, formatMoney, formatPercent } from "../usage/value/format";
import { loadValueReport, type ValueReportData } from "../usage/value/load";
import type { ReportPeriod } from "../usage/value/periods";
import type { CapabilityTool } from "./types";

/**
 * `get_value_report` (usage insight spec amendment "Value report"): the
 * value report's summary for a term or date range, so a director can ask the
 * assistant "how many staff hours did we save this fall?" and get the page's
 * own numbers. **Chat: `insights.view`** — never offered to anonymous
 * visitors or students. **MCP: super admins only**, through the twin
 * {@link getValueReportMcpTool} on `insights.export` (amendment 2026-09-30).
 * Counts and the lab's assumptions
 * only: no question text, nothing about a person, so reading it does not
 * taint the turn. Read-only; changing the assumptions is the page's alone
 * (`insights.set_value_assumptions` is `assistant: "never"`).
 */

interface ValueReportInput {
  term?: string;
  from?: string;
  to?: string;
}

const TERM_NAMES = { spring: "Spring", summer: "Summer", fall: "Fall" } as const;

function periodLabel(period: ReportPeriod): string {
  return period.kind === "term" ? `${TERM_NAMES[period.term]} ${period.year}` : `${period.from} to ${period.to}`;
}

function staffed(data: ValueReportData): string {
  const hours = data.assumptions.assumptions.staffedHours;
  const days = hours.days.length === 7 ? "every day" : hours.days.join(",") === "1,2,3,4,5" ? "Mon–Fri" : `days ${hours.days.join(",")} (0 = Sunday)`;
  return `${days}, ${formatHour(hours.openHour)}–${formatHour(hours.closeHour)} ${data.timeZone}`;
}

export function valueReportSummary(data: ValueReportData) {
  const r = data.report;
  const a = data.assumptions.assumptions;
  return {
    period: periodLabel(data.period),
    dates: { from: data.period.from, to: data.period.to, to_date: data.toDate },
    previous_period: periodLabel(data.previous),
    estimate: true,
    questions_answered: r.questionsAnswered,
    questions_in_app: r.chatTurns,
    questions_over_mcp: r.mcpQuestions,
    could_not_answer: r.unanswered,
    handled_without_staff: r.handled,
    handled_share: formatPercent(r.handledShare),
    staff_hours_saved: formatHours(r.staffHoursSaved),
    estimated_value_usd: formatMoney(r.dollarValue),
    after_hours_questions: r.afterHoursQuestions,
    after_hours_share: formatPercent(r.afterHoursShare),
    previous: {
      questions_answered: data.previousReport.questionsAnswered,
      handled_share: formatPercent(data.previousReport.handledShare),
      staff_hours_saved: formatHours(data.previousReport.staffHoursSaved),
      estimated_value_usd: formatMoney(data.previousReport.dollarValue),
      after_hours_share: formatPercent(data.previousReport.afterHoursShare),
    },
    top_tools: r.topTools.map((tool) => ({ name: tool.name ?? "Deleted tool", asked: tool.asked })),
    question_kinds: r.questionKinds,
    manual_citations: r.citations,
    unanswered_filed_as_corrections: r.unansweredFiled,
    problem_reports_filed: r.ticketsFiled,
    problem_reports_resolved: r.ticketsResolved,
    median_days_to_resolve: r.medianDaysToResolve,
    assumptions: {
      minutes_per_question: a.minutesPerQuestion,
      hourly_cost_usd: a.hourlyCost,
      staffed_hours: staffed(data),
      mcp_lookups_per_question: a.includeMcp ? a.mcpCallsPerQuestion : null,
      set_by_lab: data.assumptions.origin === "stored",
    },
    formulas: [
      "questions answered = assistant questions in the app + MCP lookups ÷ lookups per question (rounded down)",
      "handled without staff = app questions − questions it could not answer + MCP questions",
      "staff hours saved ≈ handled × minutes per question ÷ 60",
      "estimated value ≈ staff hours saved × hourly cost",
      "after hours = questions asked outside staffed hours (lab time) ÷ questions answered",
    ],
    page: `/admin/insights/value`,
  };
}

export const getValueReportTool: CapabilityTool<ValueReportInput, ReturnType<typeof valueReportSummary> | { status: "error"; message: string }> = {
  name: "get_value_report",
  description:
    "The lab's value report: for a term (e.g. 'fall-2026') or a date range, questions the assistant answered, the share handled without staff, estimated staff hours and dollars saved, questions asked outside staffed hours, top tools and follow-up counts, with the previous period and the lab's assumptions. Estimates from anonymous counts. Omit every argument for the current term. Staff only.",
  inputSchema: z.strictObject({
    term: z
      .string()
      .regex(/^(spring|summer|fall)-\d{4}$/)
      .optional()
      .describe("A term as 'fall-2026', 'spring-2027' or 'summer-2026'"),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Start of a custom range, YYYY-MM-DD (with `to`)"),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("End of a custom range, YYYY-MM-DD, inclusive (with `from`)"),
  }) as unknown as z.ZodType<ValueReportInput>,
  kind: "read",
  chatOnly: true,
  requiredPermission: "insights.view",
  run: async (input) => {
    try {
      const search = input.from && input.to ? { from: input.from, to: input.to } : input.term ? { term: input.term } : {};
      const data = await loadValueReport({ search, timeZone: labTimezone(), labHoursText: siteConfig.labHours });
      return valueReportSummary(data);
    } catch (err) {
      console.error("[get_value_report] could not read the value report", err);
      return { status: "error", message: "The value report could not be read just now. Say so; do not guess numbers." };
    }
  },
};

/**
 * `get_value_report` **over MCP** (usage insight spec amendment 2026-09-30):
 * the same input, the same loader, the same summary — a twin rather than the
 * chat tool with `chatOnly` dropped, because the two surfaces are gated
 * differently. The chat's stays on `insights.view` (admins and super admins);
 * this one is on `insights.export`, which only super admins hold. One name on
 * both surfaces, like `update_ticket`: `chatOnly` and `mcpOnly` keep them from
 * ever meeting in one tool set.
 */
export const getValueReportMcpTool: CapabilityTool<ValueReportInput, ReturnType<typeof valueReportSummary> | { status: "error"; message: string }> = {
  ...getValueReportTool,
  description:
    "The lab's value report: for a term (e.g. 'fall-2026') or a date range, questions the assistant answered, the share handled without staff, estimated staff hours and dollars saved, questions asked outside staffed hours, top tools and follow-up counts, with the previous period and the lab's assumptions. Estimates from anonymous counts; staff activity is always left out; no question text. Omit every argument for the current term. Read-only. Super admins only.",
  chatOnly: undefined,
  mcpOnly: true,
  requiredPermission: "insights.export",
};
