import type { InsightTotals } from "./queries.ts";

/**
 * The Insights page's "Answered" figure: 1 − unanswered turns ÷ assistant
 * questions in the app, as a whole percent, or null before there is a question
 * to divide by. One function so the page's totals strip and the MCP
 * `get_usage_summary` read (usage insight spec amendment 2026-09-30) agree.
 */
export function answeredPercent(totals: Pick<InsightTotals, "chatTurns" | "gaps">): number | null {
  if (totals.chatTurns <= 0) return null;
  return Math.max(0, Math.round((1 - totals.gaps / totals.chatTurns) * 100));
}
