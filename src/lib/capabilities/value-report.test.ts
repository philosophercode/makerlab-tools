// @vitest-environment node
import { nextCacheMock } from "../../../test/mocks/next-cache";
import { identityFor, mcpAccessFor } from "../../../test/utils/identities";

vi.mock("next/cache", () => nextCacheMock());

import { assistantToolForbidden } from "../actions/define";
import { resetDbForTests } from "../db/client";
import { capabilitiesForIdentity } from "./access";
import { CAPABILITIES } from "./index";
import { mcpToolsFor } from "./mcp-access";
import { getValueReportMcpTool, getValueReportTool } from "./value-report";

/**
 * `get_value_report` (usage insight spec amendment "Value report"): staff
 * only in the chat (super admins only over MCP, amendment 2026-09-30),
 * never on the deny list, and the page's own numbers.
 */

beforeEach(() => vi.stubEnv("DATABASE_URL", ""));
afterEach(() => resetDbForTests());

function chatTools(role: Parameters<typeof identityFor>[0]): string[] {
  return capabilitiesForIdentity(CAPABILITIES, identityFor(role)).flatMap((c) => c.tools.filter((t) => !t.mcpOnly).map((t) => t.name));
}

describe("who is offered get_value_report", () => {
  it("is offered to admins and super admins in the chat, never to a student or a visitor", () => {
    expect(chatTools("admin")).toContain("get_value_report");
    expect(chatTools("super_admin")).toContain("get_value_report");
    expect(chatTools("user")).not.toContain("get_value_report");
    expect(chatTools("anonymous")).not.toContain("get_value_report");
  });

  it("is offered over MCP to super admins only, through its twin (amendment 2026-09-30)", () => {
    for (const role of ["anonymous", "user", "admin"] as const) {
      expect(mcpToolsFor(CAPABILITIES, mcpAccessFor(role)).map(({ tool }) => tool.name)).not.toContain("get_value_report");
    }
    const superAdmin = mcpToolsFor(CAPABILITIES, mcpAccessFor("super_admin")).filter(({ tool }) => tool.name === "get_value_report");
    expect(superAdmin).toHaveLength(1);
    expect(superAdmin[0].tool).toBe(getValueReportMcpTool);
  });

  it("is a read on insights.view, and its name is nowhere near the deny list", () => {
    expect(getValueReportTool).toMatchObject({ kind: "read", chatOnly: true, requiredPermission: "insights.view" });
    expect(assistantToolForbidden(getValueReportTool.name)).toBe(false);
  });
});

describe("what it answers", () => {
  it("summarises the current term from the demo week: counts, estimates, assumptions and formulas, nothing about a person", async () => {
    const result = (await getValueReportTool.run({}, {})) as Record<string, unknown>;
    expect(result).toMatchObject({ estimate: true, page: "/admin/insights/value" });
    expect(result.period).toMatch(/^(Spring|Summer|Fall) \d{4}$/);
    expect(typeof result.questions_answered).toBe("number");
    expect(result.staff_hours_saved).toMatch(/^\d/);
    expect(result.estimated_value_usd).toMatch(/^\$/);
    expect(result.assumptions).toMatchObject({ minutes_per_question: 4, hourly_cost_usd: 40, set_by_lab: false });
    expect(result.formulas).toHaveLength(5);
    expect(JSON.stringify(result)).not.toMatch(/@|waterjet|question_text|email/i);
  });

  it("takes a term or a custom range", async () => {
    expect(((await getValueReportTool.run({ term: "spring-2026" }, {})) as { period: string }).period).toBe("Spring 2026");
    expect(((await getValueReportTool.run({ from: "2026-09-01", to: "2026-09-30" }, {})) as { period: string }).period).toBe("2026-09-01 to 2026-09-30");
  });

  it("refuses arguments that are not a term or a date", () => {
    expect(getValueReportTool.inputSchema.safeParse({ term: "winter-2026" }).success).toBe(false);
    expect(getValueReportTool.inputSchema.safeParse({ from: "yesterday" }).success).toBe(false);
    expect(getValueReportTool.inputSchema.safeParse({ extra: 1 }).success).toBe(false);
  });
});
