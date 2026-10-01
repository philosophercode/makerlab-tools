import { z } from "zod";
import { DEFAULT_PERIOD, insightsHref } from "../../components/admin/insights/insights-params";
import { answeredPercent } from "../usage/answered";
import { insightsTimeZone, loadInsights, type InsightPeriod, type InsightsData } from "../usage/queries";
import type { CapabilityTool } from "./types";

/**
 * `get_usage_summary` (usage insight spec amendment 2026-09-30): the Insights
 * page's **Usage** tab as numbers, so a director's own AI client can answer
 * "how is MakerLAB AI being used?" without opening the page.
 *
 * - **MCP only, super admins only** (`insights.export`). The chat's read of the
 *   same counts is phase 4's `usage_summary`, still open.
 * - **The page's own loader** (`loadInsights`, with the page's time zone), so
 *   a number here is the number on `/admin/insights` for the same window.
 * - **Counts and aggregates only.** The Unanswered queue is its three counts
 *   (open, dismissed, filed) — never a question, scrubbed or not. Tools and
 *   manuals are named from the catalogue; nothing names or describes a person,
 *   and the usage tables hold nothing that could (`lib/usage/events.ts`).
 * - **Staff left out** unless `include_staff` — the page's toggle.
 * - Read-only. Long lists are capped; the page has the rest.
 */

const TOP_TOOLS = 10;
const NEVER_ASKED_NAMES = 25;
const TOP_MANUALS = 5;
const BUSIEST_CELLS = 5;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

interface UsageSummaryInput {
  days?: InsightPeriod;
  include_staff?: boolean;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * The summary of one `loadInsights` result. Pure, and built field by field
 * from counts: `data.gaps` (the questions) is deliberately never read.
 */
export function usageSummary(data: InsightsData, query: { days: InsightPeriod; includeStaff: boolean; timeZone: string }) {
  const t = data.totals;
  const answered = answeredPercent(t);
  const busiest = data.heatmap
    .flatMap((hours, dow) => hours.map((count, hour) => ({ dow, hour, count })))
    .filter((cell) => cell.count > 0)
    .sort((a, b) => b.count - a.count || a.dow - b.dow || a.hour - b.hour)
    .slice(0, BUSIEST_CELLS)
    .map((cell) => ({ day: WEEKDAYS[cell.dow], hour: `${String(cell.hour).padStart(2, "0")}:00`, count: cell.count }));

  return {
    period_days: query.days,
    staff_included: query.includeStaff,
    lab_days: { from: data.days[0] ?? null, to: data.days[data.days.length - 1] ?? null },
    time_zone: query.timeZone,
    counting_since: data.since,
    approximate: true,
    totals: {
      assistant_questions_in_app: t.chatTurns,
      mcp_tool_calls: t.mcpCalls,
      tool_page_views: t.toolViews,
      qr_scans: t.qrScans,
      kiosk_screen_loads: t.kioskScreens,
      kiosk_qr_arrivals: t.kioskScans,
      manual_citations: t.citations,
      unanswered: t.gaps,
      answered_share: answered === null ? null : `${answered}%`,
    },
    unanswered_queue: { open: data.gapCounts.open, dismissed: data.gapCounts.dismissed, filed: data.gapCounts.filed },
    most_asked_tools: data.tools.slice(0, TOP_TOOLS).map((tool) => ({
      name: tool.name ?? "Deleted tool",
      slug: tool.slug,
      asked: tool.asked,
      asked_in_app: tool.askedChat,
      asked_over_mcp: tool.askedMcp,
      page_views: tool.views,
      qr_scans: tool.qr,
      manual_citations: tool.citations,
      unanswered: tool.gaps,
    })),
    tools_with_activity: data.tools.length,
    never_asked_tools: {
      count: data.neverAsked.length,
      names: data.neverAsked.slice(0, NEVER_ASKED_NAMES).map((tool) => tool.name),
    },
    question_kinds: {
      operate: sum(data.kinds.operate),
      debug: sum(data.kinds.debug),
      create: sum(data.kinds.create),
      other: sum(data.kinds.other),
    },
    busiest_times: busiest,
    manuals_cited: data.manuals.slice(0, TOP_MANUALS).map((manual) => ({
      title: manual.title ?? "Deleted manual",
      tool: manual.toolName,
      citations: manual.citations,
      top_pages: manual.topPages.map((page) => page.page),
    })),
    notes: [
      "Anonymous counts: no event records who caused it, and this summary carries no question text.",
      query.includeStaff ? "Staff activity is included." : "Staff activity is left out (include_staff: true counts it).",
      "unanswered = assistant turns that could not answer; answered_share = 1 − unanswered ÷ assistant questions in the app.",
      "busiest_times counts assistant questions and tool page views, in lab time.",
    ],
    page: insightsHref({ days: query.days, includeStaff: query.includeStaff }),
  };
}

export type UsageSummary = ReturnType<typeof usageSummary>;

export const getUsageSummaryTool: CapabilityTool<UsageSummaryInput, UsageSummary | { status: "error"; message: string }> = {
  name: "get_usage_summary",
  description:
    "How the lab's assistant and tool pages are being used, from anonymous counts: for the last 7, 30 or 90 days, assistant questions in the app, MCP tool calls, tool page views, QR scans, kiosk loads and QR arrivals, manual citations, unanswered turns and the answered share; the most-asked tools, tools nobody asked about, kinds of questions, the busiest hours (lab time) and the most-cited manuals. The same numbers as the Insights page's Usage tab. No question text and nothing about any person. Staff activity is left out unless include_staff is true. Read-only. Super admins only.",
  inputSchema: z.strictObject({
    days: z
      .union([z.literal(7), z.literal(30), z.literal(90)])
      .optional()
      .describe("The window: the last 7, 30 or 90 days (default 30), as on the Insights page"),
    include_staff: z.boolean().optional().describe("Count staff (admins and super admins) too. Default false, as on the page"),
  }) as unknown as z.ZodType<UsageSummaryInput>,
  kind: "read",
  mcpOnly: true,
  requiredPermission: "insights.export",
  run: async (input) => {
    const days = input.days ?? DEFAULT_PERIOD;
    const includeStaff = input.include_staff ?? false;
    const timeZone = insightsTimeZone();
    try {
      const data = await loadInsights({ days, includeStaff, timeZone });
      return usageSummary(data, { days, includeStaff, timeZone });
    } catch (err) {
      console.error("[get_usage_summary] could not read the usage counts", err);
      return { status: "error", message: "The usage counts could not be read just now. Say so; do not guess numbers." };
    }
  },
};
