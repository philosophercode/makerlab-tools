import { INSIGHT_PERIODS, type InsightPeriod } from "../../../lib/usage/queries";

/**
 * `/admin/insights`' query string (`?days=7|30|90&staff=1`): the period and
 * whether staff activity is counted. Directive-free so the page and its
 * controls share it. Anything else falls back to 30 days, staff left out.
 */
export interface InsightsParams {
  days: InsightPeriod;
  includeStaff: boolean;
}

export const DEFAULT_PERIOD: InsightPeriod = 30;

export function parseInsightsParams(search: Record<string, string | string[] | undefined>): InsightsParams {
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const days = Number(one(search.days));
  return {
    days: (INSIGHT_PERIODS as readonly number[]).includes(days) ? (days as InsightPeriod) : DEFAULT_PERIOD,
    includeStaff: one(search.staff) === "1",
  };
}

export function insightsHref(params: InsightsParams): string {
  const qs = new URLSearchParams();
  if (params.days !== DEFAULT_PERIOD) qs.set("days", String(params.days));
  if (params.includeStaff) qs.set("staff", "1");
  const query = qs.toString();
  return `/admin/insights${query ? `?${query}` : ""}`;
}
