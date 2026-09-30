// @vitest-environment node
import { nextCacheMock } from "../../../../test/mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());

import { eq, sql } from "drizzle-orm";
import { POST } from "@/app/api/mcp/route";
import { resetAuthForTests } from "@/lib/auth/config";
import { createApiToken } from "@/lib/data/api-tokens";
import { getDb, resetDbForTests } from "@/lib/db/client";
import { rawRows } from "@/lib/db/raw";
import { apiTokens, tools, usageEvents } from "@/lib/db/schema/index";
import { mcpCallUsage } from "@/lib/usage/mcp-call";
import { seedUser } from "../../../../test/utils/session";

/**
 * Usage insight over MCP (usage insight spec §3.3, §10): each tool call
 * records its tool name, and the tool it resolved — never the token, the
 * grant or the person, only the role's audience bucket.
 */

let nextId = 1;
async function callTool(name: string, args: Record<string, unknown>, headers: Record<string, string>) {
  const res = await POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-forwarded-for": "198.51.100.200", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } }),
    })
  );
  return res.json();
}

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "mcp-usage-test-secret");
  vi.stubEnv("AUTH_BASE_URL", "http://localhost");
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  vi.stubEnv("MCP_TOKEN", "");
  resetAuthForTests();
  const db = await getDb();
  await db.delete(usageEvents);
});

afterEach(async () => {
  const db = await getDb();
  await db.delete(apiTokens);
  resetAuthForTests();
});

afterAll(() => resetDbForTests());

it("records the call's tool name and the tool it found, with no token or person", async () => {
  const person = await seedUser({ email: "mcp-usage@cornell.edu", role: "user", name: "Casey Member" });
  const created = await createApiToken({ userId: person.id, name: "test", readOnly: true });
  if (!created.ok) throw new Error("expected a token");
  const db = await getDb();
  const [form4] = await db.select({ id: tools.id }).from(tools).where(eq(tools.slug, "form-4"));

  await callTool("get_tool_details", { id_or_name: "form-4" }, { authorization: `Bearer ${created.token}` });

  await vi.waitFor(async () => expect((await db.select().from(usageEvents)).length).toBe(2), { timeout: 5000 });
  const events = await db.select().from(usageEvents);
  expect(events.find((e) => e.kind === "mcp_call")).toMatchObject({ surface: "mcp", audience: "member", source: "get_tool_details" });
  expect(events.find((e) => e.kind === "tool_asked")).toMatchObject({ surface: "mcp", toolId: form4.id });
  const stored = JSON.stringify(await rawRows(db, sql`select * from usage_events`));
  for (const secret of [created.token, created.summary.id, person.id, "mcp-usage@cornell.edu", "Casey", "198.51.100.200"]) {
    expect(stored).not.toContain(secret);
  }
});

describe("mcpCallUsage", () => {
  it("counts an anonymous call as anonymous, and a call that resolved nothing as just a call", () => {
    expect(mcpCallUsage("search_tools", { count: 0 }, "anonymous")).toEqual([{ kind: "mcp_call", surface: "mcp", audience: "anonymous", source: "search_tools" }]);
    expect(mcpCallUsage("get_tool_details", { found: false }, "admin").map((e) => e.kind)).toEqual(["mcp_call"]);
    expect(mcpCallUsage("get_tool_details", { found: true, id: "not-a-uuid" }, "admin").map((e) => e.kind)).toEqual(["mcp_call"]);
  });
});
