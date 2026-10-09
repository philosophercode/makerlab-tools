// @vitest-environment node
import { nextCacheMock } from "../../../../test/mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());

import { POST } from "@/app/api/mcp/route";
import { resetAuthForTests } from "@/lib/auth/config";
import { createApiToken } from "@/lib/data/api-tokens";
import { getDb, resetDbForTests } from "@/lib/db/client";
import { apiTokens } from "@/lib/db/schema/index";
import { insightsTimeZone, loadInsights } from "@/lib/usage/queries";
import { seedUser } from "../../../../test/utils/session";

/**
 * Usage insight over MCP, through the real route (usage insight spec amendment
 * 2026-09-30): only a super admin's connection lists or runs
 * `get_usage_summary` and `get_value_report`, and what comes back is the
 * Insights page's counts with no question text.
 */

const INSIGHT_TOOLS = ["get_usage_summary", "get_value_report"];

let nextId = 1;
let ip = 10;
async function rpc(method: string, params: Record<string, unknown> | undefined, headers: Record<string, string>) {
  ip += 1;
  const res = await POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-forwarded-for": `198.51.100.${ip}`, ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, ...(params ? { params } : {}) }),
    })
  );
  return res.json();
}

async function bearerFor(role: "user" | "admin" | "super_admin", readOnly = false): Promise<Record<string, string>> {
  const person = await seedUser({ email: `mcp-insight-${role}-${Math.random().toString(36).slice(2)}@cornell.edu`, role, name: `Test ${role}` });
  const created = await createApiToken({ userId: person.id, name: "test", readOnly });
  if (!created.ok) throw new Error("expected a token");
  return { authorization: `Bearer ${created.token}` };
}

async function listed(headers: Record<string, string>): Promise<string[]> {
  const json = await rpc("tools/list", undefined, headers);
  return (json.result.tools as Array<{ name: string }>).map((tool) => tool.name);
}

function text(json: { result?: { content?: Array<{ type: string; text?: string }> } }): string {
  return (json.result?.content ?? []).map((c) => c.text ?? "").join("\n");
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "mcp-usage-insight-test-secret");
  vi.stubEnv("AUTH_BASE_URL", "http://localhost");
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  vi.stubEnv("MCP_TOKEN", "");
  resetAuthForTests();
});

afterEach(async () => {
  const db = await getDb();
  await db.delete(apiTokens);
  resetAuthForTests();
});

afterAll(() => resetDbForTests());

describe("who sees the usage reads", () => {
  it("lists them to a super admin's token, read-only too", async () => {
    for (const name of INSIGHT_TOOLS) {
      expect(await listed(await bearerFor("super_admin"))).toContain(name);
      expect(await listed(await bearerFor("super_admin", true))).toContain(name);
    }
  });

  it("lists neither to an anonymous caller, a student or an admin", async () => {
    const callers = [{}, await bearerFor("user"), await bearerFor("admin")];
    for (const headers of callers) {
      const names = await listed(headers);
      for (const name of INSIGHT_TOOLS) expect(names).not.toContain(name);
    }
  });

  it("will not run them for an admin, called directly", async () => {
    const admin = await bearerFor("admin");
    for (const name of INSIGHT_TOOLS) {
      const json = await rpc("tools/call", { name, arguments: {} }, admin);
      expect(json.error || json.result?.isError, name).toBeTruthy();
      expect(text(json)).not.toMatch(/assistant_questions_in_app|questions_answered/);
    }
  });
});

describe("what a super admin gets", () => {
  it("the page's counts for the window, with no question text", async () => {
    const director = await bearerFor("super_admin");
    const json = await rpc("tools/call", { name: "get_usage_summary", arguments: { days: 30 } }, director);
    expect(json.result.isError).toBeFalsy();
    const summary = JSON.parse(text(json));
    // Read after the call: the call itself is recorded after the response, as an `mcp_call` by staff,
    // which the default (staff left out) never counts.
    const page = await loadInsights({ days: 30, includeStaff: false, timeZone: insightsTimeZone() });
    expect(summary.totals.assistant_questions_in_app).toBe(page.totals.chatTurns);
    expect(summary.totals.tool_page_views).toBe(page.totals.toolViews);
    expect(summary.totals.unanswered).toBe(page.totals.gaps);
    expect(summary.unanswered_queue).toEqual(page.gapCounts);
    for (const gap of page.gaps) expect(text(json)).not.toContain(gap.question);
  });

  it("the value report's summary", async () => {
    const director = await bearerFor("super_admin");
    const json = await rpc("tools/call", { name: "get_value_report", arguments: {} }, director);
    expect(json.result.isError).toBeFalsy();
    expect(JSON.parse(text(json))).toMatchObject({ estimate: true, page: "/admin/insights/value" });
  });
});
