// @vitest-environment node
/**
 * Integration tests for the MCP endpoint (`src/app/api/mcp/route.ts`,
 * `src/app/api/mcp/signed-in/route.ts`; MCP access spec §3, §5, §8, §10).
 *
 * Strategy:
 * - The REAL `McpServer` the route constructs, never mocked. JSON-RPC
 *   envelopes are POSTed to the route handlers, and one test drives the route
 *   with the SDK's own `Client` over its Streamable HTTP transport, so
 *   `initialize` → `tools/list` → `tools/call` is proven at the protocol level.
 * - Identities are real: personal access tokens created through the data
 *   module for seeded users, resolved by the route exactly as in production.
 * - The catalogue is the demo-seeded PGlite database; the embedding model for
 *   `search_manual` is stubbed at the job registry (`test/ai/models-stub.ts`).
 *
 * The transport is stateless (`sessionIdGenerator: undefined`), so
 * `tools/list` / `tools/call` need no prior `initialize`; the only hard
 * requirement is an `Accept` header naming both `application/json` and
 * `text/event-stream`, else the transport answers 406.
 */

// `nextCacheMock` is imported first on purpose: `vi.mock` is hoisted above every
// import, and its factory can only reach a module imported before the one it
// replaces.
import { nextCacheMock } from "../../../../test/mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("@/lib/ai/models", async (importOriginal) =>
  (await import("../../../../test/ai/models-stub")).stubModelsModule(await importOriginal())
);

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { POST, GET } from "@/app/api/mcp/route";
import { POST as SIGNED_IN_POST } from "@/app/api/mcp/signed-in/route";
import { resetAuthForTests } from "@/lib/auth/config";
import { resetLegacyWarningForTests } from "@/lib/auth/mcp-caller";
import { createApiToken } from "@/lib/data/api-tokens";
import { getDb, resetDbForTests } from "@/lib/db/client";
import {
  apiTokens,
  attachments,
  chatProposals,
  feedback,
  maintenanceLogs,
  resources,
  tools,
  units,
} from "@/lib/db/schema/index";
import { buildDocumentPassages } from "@/lib/manuals/passages";
import { fakeEmbeddingTarget } from "../../../../test/ai/fake-embeddings";
import { resetModelStubs, setEmbeddingModel } from "../../../../test/ai/models-stub";
import { seedManual } from "../../../../test/manuals/seed";
import { seedUser } from "../../../../test/utils/session";

const MCP_URL = "http://localhost/api/mcp";
const SIGNED_IN_URL = "http://localhost/api/mcp/signed-in";
const target = fakeEmbeddingTarget();

const PUBLIC_READS = [
  "get_maintenance_history",
  "get_tool_details",
  "get_unit_details",
  "list_tools",
  "search_manual",
  "search_tools",
].sort();

let ipCounter = 0;
/** A fresh client IP per test, so the anonymous limiter never carries over. */
let testIp = "198.51.100.1";

function rpcRequest(body: unknown, headers: Record<string, string> = {}, url = MCP_URL): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "x-forwarded-for": testIp,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

let nextId = 1;
function envelope(method: string, params?: Record<string, unknown>) {
  return { jsonrpc: "2.0", id: nextId++, method, ...(params ? { params } : {}) };
}

async function callRpc(method: string, params?: Record<string, unknown>, headers: Record<string, string> = {}) {
  const res = await POST(rpcRequest(envelope(method, params), headers));
  const json = await res.json();
  return { res, json };
}

function resultText(json: { result?: { content?: Array<{ type: string; text?: string }> } }) {
  return (json.result?.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
}

async function callTool(name: string, args: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return callRpc("tools/call", { name, arguments: args }, headers);
}

async function toolNames(headers: Record<string, string> = {}): Promise<string[]> {
  const { json } = await callRpc("tools/list", undefined, headers);
  return (json.result.tools as Array<{ name: string }>).map((t) => t.name).sort();
}

/** A person with a personal access token, as `Authorization` headers. */
async function bearerFor(
  role: "user" | "admin" | "super_admin",
  options: { readOnly?: boolean; name?: string } = {}
): Promise<{ headers: Record<string, string>; userId: string; email: string; token: string; tokenId: string }> {
  const email = `mcp-${role}-${Math.random().toString(36).slice(2)}@cornell.edu`;
  const person = await seedUser({ email, role, name: options.name ?? `Test ${role}` });
  const created = await createApiToken({ userId: person.id, name: "test", readOnly: Boolean(options.readOnly) });
  if (!created.ok) throw new Error("expected a token");
  return {
    headers: { authorization: `Bearer ${created.token}` },
    userId: person.id,
    email,
    token: created.token,
    tokenId: created.summary.id,
  };
}

async function unitId(label: string): Promise<string> {
  const db = await getDb();
  const [row] = await db.select({ id: units.id }).from(units).where(eq(units.unitLabel, label));
  return row.id;
}

async function toolIdOf(slug: string): Promise<string> {
  const db = await getDb();
  const [row] = await db.select({ id: tools.id }).from(tools).where(eq(tools.slug, slug));
  return row.id;
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "mcp-route-test-secret");
  vi.stubEnv("AUTH_BASE_URL", "http://localhost");
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  vi.stubEnv("MCP_TOKEN", "");
  resetAuthForTests();
  resetLegacyWarningForTests();
  setEmbeddingModel(target.model);
  ipCounter += 1;
  testIp = `198.51.100.${ipCounter}`;
});

const insertedResources: string[] = [];
const createdTools: string[] = [];

afterEach(async () => {
  resetModelStubs();
  vi.restoreAllMocks();
  const db = await getDb();
  await db.delete(maintenanceLogs);
  await db.delete(feedback);
  await db.delete(chatProposals);
  await db.delete(apiTokens);
  await db.delete(attachments).where(eq(attachments.ownerType, "resource"));
  if (insertedResources.length) await db.delete(resources).where(inArray(resources.id, insertedResources.splice(0)));
  if (createdTools.length) await db.delete(tools).where(inArray(tools.id, createdTools.splice(0)));
});

afterAll(() => {
  resetDbForTests();
});

// ── The protocol ─────────────────────────────────────────────────────

describe("the MCP protocol, through the SDK's own client", () => {
  it("initializes, lists the tools and calls one against the route", async () => {
    const client = new Client({ name: "route-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
      fetch: async (url, init) => {
        const request = new Request(url, init);
        request.headers.set("x-forwarded-for", testIp);
        return request.method === "GET" ? GET(request) : POST(request);
      },
    });
    await client.connect(transport);
    expect(client.getServerVersion()).toMatchObject({ name: "makerlab", version: "1.0.0" });
    expect(client.getInstructions()).toMatch(/without signing in/);

    const { tools: listed } = await client.listTools();
    expect(listed.map((t) => t.name).sort()).toEqual(PUBLIC_READS);

    const result = await client.callTool({ name: "search_tools", arguments: { query: "laser" } });
    const [content] = result.content as Array<{ type: string; text: string }>;
    expect(JSON.parse(content.text).tools.map((t: { name: string }) => t.name)).toEqual(["Trotec Speedy 400"]);
    await client.close();
  });

  it("answers initialize with the server's name and version", async () => {
    const { res, json } = await callRpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0.0" },
    });
    expect(res.status).toBe(200);
    expect(json.result.serverInfo).toEqual({ name: "makerlab", version: "1.0.0" });
  });

  it("refuses GET (no SSE in serverless mode) with a JSON-RPC error", async () => {
    const res = await GET(new Request(MCP_URL, { method: "GET", headers: { accept: "application/json, text/event-stream", "x-forwarded-for": testIp } }));
    expect(res.status).toBe(405);
    const json = await res.json();
    expect(json).toMatchObject({ jsonrpc: "2.0", error: { code: -32000 }, id: null });
  });
});

// ── Who sees what ────────────────────────────────────────────────────

describe("tools/list by identity", () => {
  it("offers an anonymous caller the six public reads", async () => {
    expect(await toolNames()).toEqual(PUBLIC_READS);
  });

  it("offers a student's token their reports and no staff tool", async () => {
    const student = await bearerFor("user");
    expect(await toolNames(student.headers)).toEqual(
      [...PUBLIC_READS, "list_my_reports", "report_correction", "report_issue"].sort()
    );
  });

  it("offers a SuperMaker's token the staff tools", async () => {
    const admin = await bearerFor("admin");
    expect(await toolNames(admin.headers)).toEqual(
      [
        ...PUBLIC_READS,
        "create_tool",
        "list_intake_queue",
        "list_my_reports",
        "list_open_tickets",
        "propose_change",
        "report_correction",
        "report_issue",
        "update_ticket",
      ].sort()
    );
  });

  it("gives a read-only token no write tool", async () => {
    const admin = await bearerFor("admin", { readOnly: true });
    expect(await toolNames(admin.headers)).toEqual(
      [...PUBLIC_READS, "list_intake_queue", "list_my_reports", "list_open_tickets"].sort()
    );
  });
});

describe("tools a caller may not use", () => {
  it("cannot be called directly by a student", async () => {
    const student = await bearerFor("user");
    const { json } = await callTool("update_ticket", { ticket_id: "00000000-0000-4000-8000-000000000000", status: "closed" }, student.headers);
    // Not registered for this caller: the SDK answers "not found", never runs it.
    const refused = json.error ? json.error.message : resultText(json);
    expect(json.error || json.result?.isError).toBeTruthy();
    expect(refused).toMatch(/not found|not permitted/i);
  });

  it("cannot file a ticket anonymously or with a read-only token", async () => {
    const { json } = await callTool("report_issue", { title: "t", description: "d", priority: "Low" });
    expect(json.error || json.result?.isError).toBeTruthy();
    const readOnly = await bearerFor("user", { readOnly: true });
    const second = await callTool("report_issue", { title: "t", description: "d", priority: "Low" }, readOnly.headers);
    expect(second.json.error || second.json.result?.isError).toBeTruthy();
    const db = await getDb();
    expect(await db.select().from(maintenanceLogs)).toHaveLength(0);
  });
});

// ── Credentials ──────────────────────────────────────────────────────

describe("a bearer that does not resolve", () => {
  it("is a 401 naming the reason, with WWW-Authenticate — never anonymous", async () => {
    const unknown = await POST(rpcRequest(envelope("tools/list"), { authorization: `Bearer mlt_${"q".repeat(43)}` }));
    expect(unknown.status).toBe(401);
    expect((await unknown.json()).error).toMatchObject({ code: -32001, message: expect.stringMatching(/unknown token/) });
    expect(unknown.headers.get("www-authenticate")).toContain(
      'resource_metadata="http://localhost/.well-known/oauth-protected-resource/api/mcp"'
    );

    const person = await bearerFor("user");
    const db = await getDb();
    await db.update(apiTokens).set({ revokedAt: sql`now()` }).where(eq(apiTokens.id, person.tokenId));
    const revoked = await POST(rpcRequest(envelope("tools/list"), person.headers));
    expect(revoked.status).toBe(401);
    expect((await revoked.json()).error.message).toMatch(/token revoked/);

    const other = await bearerFor("user");
    await db.update(apiTokens).set({ expiresAt: sql`now() - interval '1 second'` }).where(eq(apiTokens.id, other.tokenId));
    const expired = await POST(rpcRequest(envelope("tools/list"), other.headers));
    expect(expired.status).toBe(401);
    expect((await expired.json()).error.message).toMatch(/token expired/);
  });
});

describe("/api/mcp/signed-in", () => {
  it("answers an anonymous caller 401 pointing at the protected-resource metadata", async () => {
    const res = await SIGNED_IN_POST(rpcRequest(envelope("tools/list"), {}, SIGNED_IN_URL));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="http://localhost/.well-known/oauth-protected-resource/api/mcp/signed-in"'
    );
  });

  it("serves a signed-in caller the same tools as /api/mcp", async () => {
    const student = await bearerFor("user");
    const res = await SIGNED_IN_POST(rpcRequest(envelope("tools/list"), student.headers, SIGNED_IN_URL));
    expect(res.status).toBe(200);
    const names = ((await res.json()).result.tools as Array<{ name: string }>).map((t) => t.name);
    expect(names).toContain("list_my_reports");
  });
});

describe("the retired MCP_TOKEN", () => {
  it("no longer gates the endpoint: anonymous callers get the public reads", async () => {
    vi.stubEnv("MCP_TOKEN", "secret-mcp");
    const { res } = await callRpc("tools/list");
    expect(res.status).toBe(200);
    expect(await toolNames()).toEqual(PUBLIC_READS);
  });

  it("is accepted for one release as a read-only, no-role identity", async () => {
    vi.stubEnv("MCP_TOKEN", "secret-mcp");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await toolNames({ authorization: "Bearer secret-mcp" })).toEqual(PUBLIC_READS);
  });

  it("does not turn a wrong bearer into anonymous", async () => {
    vi.stubEnv("MCP_TOKEN", "secret-mcp");
    const res = await POST(rpcRequest(envelope("tools/list"), { authorization: "Bearer wrong-token" }));
    expect(res.status).toBe(401);
  });
});

// ── Rate limits (§5.2) ───────────────────────────────────────────────

describe("rate limiting", () => {
  it("allows an anonymous IP 30 requests a minute", async () => {
    for (let i = 0; i < 30; i += 1) {
      const res = await POST(rpcRequest(envelope("tools/list")));
      expect(res.status).toBe(200);
    }
    const res = await POST(rpcRequest(envelope("tools/list")));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect((await res.json()).error.message).toMatch(/too many requests/i);
  });

  it("allows a token 60 a minute, per token rather than per IP", async () => {
    const student = await bearerFor("user");
    for (let i = 0; i < 60; i += 1) {
      const res = await POST(rpcRequest(envelope("tools/list"), student.headers));
      expect(res.status).toBe(200);
    }
    expect((await POST(rpcRequest(envelope("tools/list"), student.headers))).status).toBe(429);
    // Same IP, another person's token: their own allowance.
    const other = await bearerFor("user");
    expect((await POST(rpcRequest(envelope("tools/list"), other.headers))).status).toBe(200);
  });

  it("allows 10 write calls a minute per identity", async () => {
    const student = await bearerFor("user");
    for (let i = 0; i < 10; i += 1) {
      const { json } = await callTool("report_issue", { title: `t${i}`, description: "d", priority: "Low" }, student.headers);
      expect(json.result.isError).toBeFalsy();
    }
    const { json } = await callTool("report_issue", { title: "t11", description: "d", priority: "Low" }, student.headers);
    expect(json.result.isError).toBe(true);
    expect(resultText(json)).toMatch(/too many changes/i);
    const db = await getDb();
    expect(await db.select().from(maintenanceLogs)).toHaveLength(10);
  });
});

// ── The public reads ─────────────────────────────────────────────────

describe("tools/call: the catalogue", () => {
  it("list_tools returns the published catalogue, filterable", async () => {
    const all = JSON.parse(resultText((await callTool("list_tools")).json));
    expect(all.count).toBe(2);
    expect(all.tools.every((t: { state?: string }) => t.state === undefined)).toBe(true);
    const laser = JSON.parse(resultText((await callTool("list_tools", { category: "laser" })).json));
    expect(laser.tools.map((t: { name: string }) => t.name)).toEqual(["Trotec Speedy 400"]);
    const resin = JSON.parse(resultText((await callTool("list_tools", { location: "Resin" })).json));
    expect(resin.tools.map((t: { name: string }) => t.name)).toEqual(["Form 4"]);
  });

  it("search_tools matches and misses", async () => {
    const hit = JSON.parse(resultText((await callTool("search_tools", { query: "resin" })).json));
    expect(hit.tools.map((t: { name: string }) => t.name)).toContain("Form 4");
    const miss = JSON.parse(resultText((await callTool("search_tools", { query: "nonexistent-widget-xyz" })).json));
    expect(miss).toEqual({ query: "nonexistent-widget-xyz", count: 0, tools: [] });
  });

  it("get_tool_details resolves by slug and by name, and says when it cannot", async () => {
    const bySlug = JSON.parse(resultText((await callTool("get_tool_details", { id_or_name: "form-4" })).json));
    expect(bySlug).toMatchObject({ slug: "form-4", name: "Form 4", detail_page: "/tools/form-4" });
    const byName = JSON.parse(resultText((await callTool("get_tool_details", { id_or_name: "Trotec" })).json));
    expect(byName.slug).toBe("trotec-speedy-400");
    const missing = await callTool("get_tool_details", { id_or_name: "no-such-tool-id" });
    expect(missing.json.result.isError).toBeFalsy();
    expect(JSON.parse(resultText(missing.json))).toMatchObject({ found: false });
  });

  it("shows staff drafts and archived tools, marked — and nobody else", async () => {
    const db = await getDb();
    const [draft] = await db.insert(tools).values({ slug: "mcp-draft", name: "Draft Bandsaw", published: false }).returning({ id: tools.id });
    const [archived] = await db
      .insert(tools)
      .values({ slug: "mcp-archived", name: "Archived Lathe", published: true, archivedAt: new Date() })
      .returning({ id: tools.id });
    createdTools.push(draft.id, archived.id);

    const anonymous = JSON.parse(resultText((await callTool("list_tools")).json));
    expect(anonymous.tools.map((t: { name: string }) => t.name)).not.toContain("Draft Bandsaw");

    const student = await bearerFor("user");
    const studentList = JSON.parse(resultText((await callTool("list_tools", {}, student.headers)).json));
    expect(studentList.count).toBe(2);

    const admin = await bearerFor("admin");
    const staffList = JSON.parse(resultText((await callTool("list_tools", {}, admin.headers)).json));
    const byName = Object.fromEntries(staffList.tools.map((t: { name: string; state: string }) => [t.name, t.state]));
    expect(byName).toMatchObject({ "Draft Bandsaw": "draft", "Archived Lathe": "archived", "Form 4": "published" });
    const details = JSON.parse(resultText((await callTool("get_tool_details", { id_or_name: "mcp-draft" }, admin.headers)).json));
    expect(details).toMatchObject({ name: "Draft Bandsaw", state: "draft" });
  });
});

describe("maintenance history names (§3.2 fix)", () => {
  async function seedLog() {
    const db = await getDb();
    await db.insert(maintenanceLogs).values({
      title: "Resin tank cloudy",
      unitId: await unitId("Form 4 // A"),
      type: "repair",
      priority: "high",
      status: "open",
      dateReported: "2024-09-01",
      description: "The resin tank film is clouded.",
      reportedByName: "Casey Reporter",
      reportedByEmail: "casey@cornell.edu",
    });
  }

  it("gives anonymous callers and students dates, status and summaries only", async () => {
    await seedLog();
    for (const headers of [{}, (await bearerFor("user")).headers]) {
      for (const tool of ["get_maintenance_history", "get_unit_details"]) {
        const { json } = await callTool(tool, { unit_label: "Form 4 // A" }, headers);
        const text = resultText(json);
        const parsed = JSON.parse(text);
        expect(parsed.maintenance_logs).toHaveLength(1);
        expect(parsed.maintenance_logs[0]).toMatchObject({ title: "Resin tank cloudy", type: "Repair", priority: "High", status: "Open" });
        expect(parsed.maintenance_logs[0]).not.toHaveProperty("reported_by");
        expect(text).not.toContain("Casey");
        expect(text).not.toContain("casey@");
      }
    }
  });

  it("gives staff the reporter's name, never the email", async () => {
    await seedLog();
    const admin = await bearerFor("admin");
    const { json } = await callTool("get_maintenance_history", { unit_label: "Form 4 // A" }, admin.headers);
    const text = resultText(json);
    expect(JSON.parse(text).maintenance_logs[0].reported_by).toBe("Casey Reporter");
    expect(text).not.toContain("casey@");
  });

  it("answers a unit with no logs, and an unknown unit, as structured results", async () => {
    const empty = JSON.parse(resultText((await callTool("get_maintenance_history", { unit_label: "Form 4 // A" })).json));
    expect(empty).toMatchObject({ found: true, maintenance_logs: [] });
    const unknown = JSON.parse(resultText((await callTool("get_unit_details", { unit_label: "no-such-unit-999" })).json));
    expect(unknown.found).toBe(false);
  });
});

describe("search_manual", () => {
  it("never lets a private manual reach an anonymous caller or a student, and gives it to staff", async () => {
    const db = await getDb();
    const seeded = await seedManual(db, {
      toolId: await toolIdOf("form-4"),
      title: "Form 4 staff SOP",
      pages: ["Staff only: reset the resin heater breaker behind panel C before recalibrating."],
      access: "private",
    });
    insertedResources.push(seeded.resourceId);
    expect((await buildDocumentPassages(db, seeded.documentId, { target })).status).toBe("built");
    vi.spyOn(console, "info").mockImplementation(() => {});

    for (const headers of [{}, (await bearerFor("user")).headers]) {
      const text = resultText((await callTool("search_manual", { query: "resin heater breaker panel" }, headers)).json);
      expect(text).not.toContain("panel C");
    }
    const admin = await bearerFor("admin");
    const staff = resultText((await callTool("search_manual", { query: "resin heater breaker panel" }, admin.headers)).json);
    expect(staff).toContain("panel C");
  });
});

// ── Signed-in tools ──────────────────────────────────────────────────

describe("reports under a verified name", () => {
  it("report_issue records the token owner's name, email and id, ignoring reported_by", async () => {
    const student = await bearerFor("user", { name: "Verified Student" });
    const { json } = await callTool(
      "report_issue",
      { title: "Nozzle clogged", description: "Extruder clicks", priority: "High", reported_by: "Somebody Else" },
      student.headers
    );
    expect(JSON.parse(resultText(json)).success).toBe(true);
    const db = await getDb();
    const [log] = await db.select().from(maintenanceLogs);
    expect(log).toMatchObject({
      reportedByName: "Verified Student",
      reportedByEmail: student.email,
      reportedByUserId: student.userId,
    });
  });

  it("report_correction records the token owner", async () => {
    const student = await bearerFor("user", { name: "Correcting Student" });
    const { json } = await callTool(
      "report_correction",
      { tool_id: "form-4", field_flagged: "description", issue_description: "Build volume is wrong" },
      student.headers
    );
    expect(JSON.parse(resultText(json)).success).toBe(true);
    const db = await getDb();
    const [row] = await db.select().from(feedback);
    expect(row).toMatchObject({ reporterUserId: student.userId, reporterEmail: student.email });
  });

  it("list_my_reports returns only the caller's own", async () => {
    const me = await bearerFor("user");
    const someoneElse = await bearerFor("user");
    await callTool("report_issue", { title: "Mine", description: "d", priority: "Low" }, me.headers);
    await callTool("report_issue", { title: "Theirs", description: "d", priority: "Low" }, someoneElse.headers);
    await callTool("report_correction", { tool_id: "form-4", field_flagged: "name", issue_description: "typo" }, me.headers);

    const parsed = JSON.parse(resultText((await callTool("list_my_reports", {}, me.headers)).json));
    expect(parsed.status).toBe("ok");
    expect(parsed.tickets.map((t: { title: string }) => t.title)).toEqual(["Mine"]);
    expect(parsed.corrections).toHaveLength(1);
    expect(JSON.stringify(parsed)).not.toContain(someoneElse.email);
  });
});

describe("staff tools", () => {
  async function seedTicket(): Promise<string> {
    const db = await getDb();
    const [row] = await db
      .insert(maintenanceLogs)
      .values({ title: "Laser bed out of focus", status: "open", priority: "high", toolId: await toolIdOf("trotec-speedy-400"), reportedByName: "Casey", reportedByEmail: "casey@cornell.edu" })
      .returning({ id: maintenanceLogs.id });
    return row.id;
  }

  it("list_open_tickets shows the open queue with names and no email addresses", async () => {
    await seedTicket();
    const admin = await bearerFor("admin");
    const text = resultText((await callTool("list_open_tickets", {}, admin.headers)).json);
    const parsed = JSON.parse(text);
    expect(parsed.count).toBe(1);
    expect(parsed.tickets[0]).toMatchObject({ title: "Laser bed out of focus", tool: "Trotec Speedy 400", reported_by: "Casey" });
    expect(text).not.toContain("casey@");
  });

  it("update_ticket writes through the admin page's path, as the token's owner", async () => {
    const ticketId = await seedTicket();
    const admin = await bearerFor("admin", { name: "Sam SuperMaker" });
    const { json } = await callTool(
      "update_ticket",
      { ticket_id: ticketId, status: "in_progress", assign_to: "me", resolution: "Refocused" },
      admin.headers
    );
    expect(JSON.parse(resultText(json))).toEqual({ status: "updated", ticket_id: ticketId });
    const db = await getDb();
    const [row] = await db.select().from(maintenanceLogs).where(eq(maintenanceLogs.id, ticketId));
    expect(row).toMatchObject({
      status: "in_progress",
      assignedToUserId: admin.userId,
      assignedToName: "Sam SuperMaker",
      resolution: "Refocused",
      updatedBy: admin.userId,
    });
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/admin/maintenance");

    const bad = JSON.parse(resultText((await callTool("update_ticket", { ticket_id: "not-a-ticket", status: "closed" }, admin.headers)).json));
    expect(bad).toMatchObject({ status: "refused", code: "not_found" });
  });

  it("stops a demoted admin's token at the next call", async () => {
    const ticketId = await seedTicket();
    const admin = await bearerFor("admin");
    const { user } = await import("@/lib/db/schema/index");
    const db = await getDb();
    await db.update(user).set({ role: "user" }).where(eq(user.id, admin.userId));
    expect(await toolNames(admin.headers)).not.toContain("update_ticket");
    const { json } = await callTool("update_ticket", { ticket_id: ticketId, status: "closed" }, admin.headers);
    expect(json.error || json.result?.isError).toBeTruthy();
    const [row] = await db.select().from(maintenanceLogs).where(eq(maintenanceLogs.id, ticketId));
    expect(row.status).toBe("open");
  });

  it("list_intake_queue lists what is waiting, read-only", async () => {
    const admin = await bearerFor("admin");
    const parsed = JSON.parse(resultText((await callTool("list_intake_queue", {}, admin.headers)).json));
    expect(parsed.open.map((item: { name: string }) => item.name)).toEqual(
      expect.arrayContaining(["Prusa MK4S", "Glowforge Pro"])
    );
    expect(parsed.open[0].review_page).toMatch(/^\/admin\/intake\//);
  });

  it("propose_change stores a proposal and changes nothing", async () => {
    const admin = await bearerFor("admin");
    const db = await getDb();
    const [before] = await db.select().from(tools).where(eq(tools.slug, "form-4"));
    const { json } = await callTool(
      "propose_change",
      { tool: "form-4", field: "description", value: "A resin printer.", citations: [{ quote: "A resin printer", url: "https://formlabs.com/form-4" }], reason: "Clearer" },
      admin.headers
    );
    const parsed = JSON.parse(resultText(json));
    expect(parsed).toMatchObject({ status: "proposed", verified: [false] });
    expect(parsed.message).toMatch(/not applied/);

    const [after] = await db.select().from(tools).where(eq(tools.slug, "form-4"));
    expect(after.description).toBe(before.description);
    const [proposal] = await db.select().from(chatProposals).where(and(eq(chatProposals.id, parsed.proposalId), eq(chatProposals.chatId, "mcp")));
    expect(proposal).toMatchObject({ subjectKind: "tool", subjectId: before.id, createdBy: admin.userId, decidedAt: null });
  });

  it("propose_change never proposes PPE", async () => {
    const admin = await bearerFor("admin");
    const { json } = await callTool("propose_change", { tool: "form-4", field: "ppe_required", value: ["gloves"] }, admin.headers);
    expect(JSON.parse(resultText(json))).toMatchObject({ status: "refused", code: "ppe_not_proposed" });
    const db = await getDb();
    expect(await db.select().from(chatProposals)).toHaveLength(0);
  });

  it("propose_change keeps the lab's rules: restrictions only gain a line, training is never turned off", async () => {
    const admin = await bearerFor("admin");
    const added = JSON.parse(
      resultText(
        (await callTool("propose_change", { tool: "form-4", field: "use_restrictions", value: "Young or inexperienced users must be supervised." }, admin.headers))
          .json
      )
    );
    expect(added).toMatchObject({ status: "proposed", lab_rules_kept: true });
    const db = await getDb();
    const [row] = await db.select().from(chatProposals).where(eq(chatProposals.id, added.proposalId));
    expect(row.proposal).toMatchObject({
      proposed: "Resin handling training required before first print.\nYoung or inexperienced users must be supervised.",
    });

    const off = JSON.parse(resultText((await callTool("propose_change", { tool: "form-4", field: "training_required", value: false }, admin.headers)).json));
    expect(off).toMatchObject({ status: "refused", code: "lab_rule_kept" });
  });

  it("create_tool makes an unpublished draft credited to the token's owner", async () => {
    const admin = await bearerFor("admin");
    const { json } = await callTool(
      "create_tool",
      {
        candidate: {
          name: "MCP Test Drill Press",
          description: "A drill press.",
          materials: [],
          ppe_required: [],
          tags: [],
          units: [],
          resources: [],
          image_upload_ids: [],
          source_urls: [],
        },
      },
      admin.headers
    );
    const parsed = JSON.parse(resultText(json));
    expect(parsed.success).toBe(true);
    createdTools.push(parsed.tool_id);
    const db = await getDb();
    const [row] = await db.select().from(tools).where(eq(tools.id, parsed.tool_id));
    expect(row).toMatchObject({ published: false, createdBy: admin.userId });
  });
});

// ── Secrets ──────────────────────────────────────────────────────────

describe("logging", () => {
  it("never writes a token to the console, whatever happens on the call", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level));
    const student = await bearerFor("user");
    await callRpc("tools/list", undefined, student.headers);
    await callTool("report_issue", { title: "x", description: "y", priority: "Low" }, student.headers);
    await callTool("list_my_reports", {}, student.headers);
    const db = await getDb();
    await db.update(apiTokens).set({ revokedAt: sql`now()` }).where(eq(apiTokens.id, student.tokenId));
    await callRpc("tools/list", undefined, student.headers);
    for (const spy of spies) {
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(student.token.slice(12));
    }
  });
});
