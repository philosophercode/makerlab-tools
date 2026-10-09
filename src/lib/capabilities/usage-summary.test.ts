// @vitest-environment node
import { nextCacheMock } from "../../../test/mocks/next-cache";
import { identityFor, mcpAccessFor } from "../../../test/utils/identities";

vi.mock("next/cache", () => nextCacheMock());

import { assistantToolForbidden } from "../actions/define";
import type { Role } from "../auth/roles";
import { resetDbForTests } from "../db/client";
import { insightsTimeZone, loadInsights } from "../usage/queries";
import { capabilitiesForIdentity } from "./access";
import { CAPABILITIES } from "./index";
import { describeMcpTools, mcpToolNamesForRole } from "./mcp-catalog";
import { mcpToolsFor } from "./mcp-access";
import { getUsageSummaryTool, type UsageSummary } from "./usage-summary";
import { getValueReportMcpTool } from "./value-report";

/**
 * Usage insight over MCP (usage insight spec amendment 2026-09-30):
 * `get_usage_summary` and the MCP twin of `get_value_report` are offered to
 * super admins only, carry counts and no question text, and give the
 * Insights page's own numbers.
 */

beforeEach(() => vi.stubEnv("DATABASE_URL", ""));
afterEach(() => resetDbForTests());

const ROLES: Role[] = ["anonymous", "user", "admin", "super_admin"];
const MCP_INSIGHT_TOOLS = ["get_usage_summary", "get_value_report"];

function mcpNames(role: Role, readOnly = false): string[] {
  return mcpToolsFor(CAPABILITIES, mcpAccessFor(role, readOnly)).map(({ tool }) => tool.name);
}

function chatTools(role: Role): string[] {
  return capabilitiesForIdentity(CAPABILITIES, identityFor(role)).flatMap((c) => c.tools.filter((t) => !t.mcpOnly).map((t) => t.name));
}

describe("who is offered the usage reads over MCP", () => {
  it("lists both to a super admin, read-only connections included", () => {
    for (const name of MCP_INSIGHT_TOOLS) {
      expect(mcpNames("super_admin")).toContain(name);
      expect(mcpNames("super_admin", true)).toContain(name);
    }
  });

  it("lists neither to an admin, a student or an anonymous caller", () => {
    for (const role of ["anonymous", "user", "admin"] as const) {
      for (const name of MCP_INSIGHT_TOOLS) expect(mcpNames(role), `${role} ${name}`).not.toContain(name);
    }
  });

  it("lists each once, and the /mcp page marks them for super admins only", () => {
    for (const name of MCP_INSIGHT_TOOLS) {
      expect(mcpNames("super_admin").filter((listed) => listed === name)).toHaveLength(1);
      expect(describeMcpTools(CAPABILITIES).filter((tool) => tool.name === name)).toHaveLength(1);
      for (const role of ROLES) expect(mcpToolNamesForRole(CAPABILITIES, role).has(name), `${role} ${name}`).toBe(role === "super_admin");
    }
  });

  it("are reads on insights.export, MCP only, and nowhere near the deny list", () => {
    for (const tool of [getUsageSummaryTool, getValueReportMcpTool]) {
      expect(tool).toMatchObject({ kind: "read", mcpOnly: true, requiredPermission: "insights.export" });
      expect(tool.chatOnly).toBeFalsy();
      expect(assistantToolForbidden(tool.name)).toBe(false);
    }
  });

  it("leaves the chat as it was: get_value_report for admins and super admins, get_usage_summary for nobody", () => {
    expect(chatTools("admin")).toContain("get_value_report");
    expect(chatTools("super_admin")).toContain("get_value_report");
    for (const role of ROLES) expect(chatTools(role)).not.toContain("get_usage_summary");
  });
});

describe("what get_usage_summary answers", () => {
  it("gives the Insights page's own numbers for the same window, staff left out", async () => {
    const summary = (await getUsageSummaryTool.run({}, {})) as UsageSummary;
    const page = await loadInsights({ days: 30, includeStaff: false, timeZone: insightsTimeZone() });

    expect(summary).toMatchObject({ period_days: 30, staff_included: false, page: "/admin/insights", time_zone: insightsTimeZone() });
    expect(summary.totals).toEqual({
      assistant_questions_in_app: page.totals.chatTurns,
      mcp_tool_calls: page.totals.mcpCalls,
      tool_page_views: page.totals.toolViews,
      qr_scans: page.totals.qrScans,
      kiosk_screen_loads: page.totals.kioskScreens,
      kiosk_qr_arrivals: page.totals.kioskScans,
      manual_citations: page.totals.citations,
      cross_tool_citations: page.totals.crossToolCitations,
      unanswered: page.totals.gaps,
      answered_share: `${Math.max(0, Math.round((1 - page.totals.gaps / page.totals.chatTurns) * 100))}%`,
    });
    expect(summary.totals.assistant_questions_in_app).toBeGreaterThan(0);
    expect(summary.unanswered_queue).toEqual(page.gapCounts);
    expect(summary.tools_with_activity).toBe(page.tools.length);
    expect(summary.most_asked_tools.map((tool) => [tool.name, tool.asked, tool.page_views])).toEqual(
      page.tools.slice(0, 10).map((tool) => [tool.name ?? "Deleted tool", tool.asked, tool.views])
    );
    expect(summary.never_asked_tools.count).toBe(page.neverAsked.length);
    const kindTotal = (kind: keyof typeof page.kinds) => page.kinds[kind].reduce((a, b) => a + b, 0);
    expect(summary.question_kinds).toEqual({ operate: kindTotal("operate"), debug: kindTotal("debug"), create: kindTotal("create"), other: kindTotal("other") });
  });

  it("counts staff only when asked, as the page's toggle does", async () => {
    const without = (await getUsageSummaryTool.run({ days: 7 }, {})) as UsageSummary;
    const withStaff = (await getUsageSummaryTool.run({ days: 7, include_staff: true }, {})) as UsageSummary;
    const page = await loadInsights({ days: 7, includeStaff: true, timeZone: insightsTimeZone() });
    expect(withStaff).toMatchObject({ staff_included: true, page: "/admin/insights?days=7&staff=1" });
    expect(withStaff.totals.assistant_questions_in_app).toBe(page.totals.chatTurns);
    // The demo week has a little staff testing.
    expect(withStaff.totals.assistant_questions_in_app).toBeGreaterThan(without.totals.assistant_questions_in_app);
  });

  it("carries no question text and nothing about a person", async () => {
    const summary = await getUsageSummaryTool.run({ days: 90, include_staff: true }, {});
    const page = await loadInsights({ days: 90, includeStaff: true, timeZone: insightsTimeZone() });
    const text = JSON.stringify(summary);
    expect(page.gaps.length).toBeGreaterThan(0);
    for (const gap of page.gaps) expect(text).not.toContain(gap.question);
    expect(text).not.toMatch(/waterjet|@|"question"|user_?id|email|reporter|session/i);
  });

  it("refuses a window the page does not have, and anything else", () => {
    expect(getUsageSummaryTool.inputSchema.safeParse({ days: 14 }).success).toBe(false);
    expect(getUsageSummaryTool.inputSchema.safeParse({ days: "30" }).success).toBe(false);
    expect(getUsageSummaryTool.inputSchema.safeParse({ include_staff: "yes" }).success).toBe(false);
    expect(getUsageSummaryTool.inputSchema.safeParse({ question: "x" }).success).toBe(false);
    expect(getUsageSummaryTool.inputSchema.safeParse({ days: 90, include_staff: true }).success).toBe(true);
  });
});

describe("what get_value_report answers over MCP", () => {
  it("is the chat's summary: the same numbers, no question text", async () => {
    const result = (await getValueReportMcpTool.run({}, {})) as Record<string, unknown>;
    expect(result).toMatchObject({ estimate: true, page: "/admin/insights/value" });
    expect(typeof result.questions_answered).toBe("number");
    expect(JSON.stringify(result)).not.toMatch(/@|waterjet|question_text|email/i);
  });
});
