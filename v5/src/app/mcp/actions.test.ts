// @vitest-environment node
/**
 * `/mcp`'s "Try it" server action (MCP access spec, amendment 2026-09-25),
 * end to end over PGlite: the real MCP handler, real sessions and tokens, the
 * real rate limiter. Only `next/headers` and `next/cache` are stubbed (they
 * need a Next request scope), and the embedding model for `search_manual`.
 *
 * The point of every test here: the page runs a tool **as an anonymous
 * caller**, whoever is signed in to it, and can run only the public reads.
 */

import { nextCacheMock } from "../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());
vi.mock("@/lib/ai/models", async (importOriginal) =>
  (await import("../../../test/ai/models-stub")).stubModelsModule(await importOriginal())
);

import { eq, inArray } from "drizzle-orm";
import { POST } from "@/app/api/mcp/route";
import { resetAuthForTests } from "@/lib/auth/config";
import { createApiToken } from "@/lib/data/api-tokens";
import { getDb, resetDbForTests } from "@/lib/db/client";
import { apiTokens, attachments, maintenanceLogs, resources, tools, units } from "@/lib/db/schema/index";
import { buildDocumentPassages } from "@/lib/manuals/passages";
import { TRY_IT_MAX_INPUT_CHARS, type TryItResult } from "@/lib/mcp/try-it";
import { fakeEmbeddingTarget } from "../../../test/ai/fake-embeddings";
import { resetModelStubs, setEmbeddingModel } from "../../../test/ai/models-stub";
import { seedManual } from "../../../test/manuals/seed";
import { signInAsNew } from "../../../test/utils/session";
import { runMcpTryIt } from "./actions";

const target = fakeEmbeddingTarget();
let ipCounter = 0;
let testIp = "203.0.113.1";

const insertedResources: string[] = [];
const createdTools: string[] = [];

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "mcp-try-it-test-secret");
  vi.stubEnv("AUTH_BASE_URL", "http://localhost");
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  vi.stubEnv("MCP_TOKEN", "");
  resetAuthForTests();
  setEmbeddingModel(target.model);
  ipCounter += 1;
  testIp = `203.0.113.${ipCounter}`;
  setMockHeaders({ "x-forwarded-for": testIp });
});

afterEach(async () => {
  resetModelStubs();
  vi.restoreAllMocks();
  const db = await getDb();
  await db.delete(maintenanceLogs);
  await db.delete(apiTokens);
  await db.delete(attachments).where(eq(attachments.ownerType, "resource"));
  if (insertedResources.length) await db.delete(resources).where(inArray(resources.id, insertedResources.splice(0)));
  if (createdTools.length) await db.delete(tools).where(inArray(tools.id, createdTools.splice(0)));
});

afterAll(() => {
  resetDbForTests();
});

/** Sign in to the page as a SuperMaker — session cookie *and* their token in the headers. */
async function asAdminOnThePage() {
  const signedIn = await signInAsNew({
    email: `try-it-admin-${Math.random().toString(36).slice(2)}@cornell.edu`,
    role: "admin",
    name: "Ada Admin",
  });
  const created = await createApiToken({ userId: signedIn.user.id, name: "t", readOnly: false, expiry: "90" });
  if (!created.ok) throw new Error("expected a token");
  setMockHeaders({
    cookie: signedIn.cookie,
    authorization: `Bearer ${created.token}`,
    "x-forwarded-for": testIp,
  });
}

function toolText(result: TryItResult): string {
  if (!result.ok) throw new Error(`expected a run, got ${result.error}`);
  const response = result.response as { result?: { content?: { type: string; text: string }[] } };
  return (response.result?.content ?? []).map((part) => part.text).join("\n");
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

describe("running a public read", () => {
  it("answers with the status, the time taken and the JSON-RPC response", async () => {
    const result = await runMcpTryIt({ tool: "search_tools", arguments: { query: "laser" } });
    expect(result).toMatchObject({ ok: true, status: 200 });
    if (!result.ok) return;
    expect(typeof result.durationMs).toBe("number");
    expect(result.response).toMatchObject({ jsonrpc: "2.0", id: 1 });
    expect(JSON.parse(toolText(result)).tools.map((t: { name: string }) => t.name)).toContain("Trotec Speedy 400");
  });

  it("runs get_tool_details like an MCP client would", async () => {
    const result = await runMcpTryIt({ tool: "get_tool_details", arguments: { id_or_name: "form-4" } });
    expect(JSON.parse(toolText(result))).toMatchObject({ slug: "form-4", name: "Form 4" });
  });
});

describe("the caller is anonymous, whoever is signed in to the page", () => {
  it("shows a signed-in admin no drafts", async () => {
    const db = await getDb();
    const [draft] = await db.insert(tools).values({ slug: "try-it-draft", name: "Draft Bandsaw", published: false }).returning({ id: tools.id });
    createdTools.push(draft.id);
    await asAdminOnThePage();

    const listed = JSON.parse(toolText(await runMcpTryIt({ tool: "list_tools", arguments: {} })));
    expect(listed.tools.map((t: { name: string }) => t.name)).not.toContain("Draft Bandsaw");
    expect(listed.tools.every((t: { state?: string }) => t.state === undefined)).toBe(true);
    const details = JSON.parse(toolText(await runMcpTryIt({ tool: "get_tool_details", arguments: { id_or_name: "try-it-draft" } })));
    expect(details).toMatchObject({ found: false });
  });

  it("gives a signed-in admin no private manual passage", async () => {
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
    await asAdminOnThePage();

    const text = toolText(await runMcpTryIt({ tool: "search_manual", arguments: { query: "resin heater breaker panel" } }));
    expect(text).not.toContain("panel C");
  });

  it("gives a signed-in admin no reporter names", async () => {
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
    await asAdminOnThePage();

    const text = toolText(await runMcpTryIt({ tool: "get_maintenance_history", arguments: { unit_label: "Form 4 // A" } }));
    expect(JSON.parse(text).maintenance_logs).toHaveLength(1);
    expect(text).not.toContain("Casey");
  });
});

describe("what the page may run", () => {
  it("refuses every write and every staff or chat-only tool before any call, even for an admin", async () => {
    await asAdminOnThePage();
    for (const tool of [
      "report_issue",
      "report_correction",
      "list_my_reports",
      "create_tool",
      "list_intake_queue",
      "list_open_tickets",
      "update_ticket",
      "propose_change",
      "identify_tools",
      "read_page",
      "no_such_tool",
    ]) {
      expect(await runMcpTryIt({ tool, arguments: {} })).toEqual({ ok: false, error: "not_runnable" });
    }
    const db = await getDb();
    expect(await db.select().from(maintenanceLogs)).toHaveLength(0);
  });

  it("refuses arguments that are not a small flat object", async () => {
    const bad: unknown[] = [
      { tool: "search_tools", arguments: ["laser"] },
      { tool: "search_tools", arguments: { query: { nested: true } } },
      { tool: "search_tools", arguments: { query: Number.NaN } },
      { tool: "search_tools", arguments: { query: "x".repeat(TRY_IT_MAX_INPUT_CHARS) } },
      { tool: 42 },
      null,
    ];
    for (const input of bad) {
      expect(await runMcpTryIt(input as never)).toEqual({ ok: false, error: "invalid_input" });
    }
  });
});

describe("rate limit", () => {
  it("shares the anonymous 30-a-minute bucket with /api/mcp, per IP", async () => {
    for (let i = 0; i < 15; i += 1) {
      expect(await runMcpTryIt({ tool: "search_tools", arguments: { query: "laser" } })).toMatchObject({ status: 200 });
    }
    for (let i = 0; i < 15; i += 1) {
      const res = await POST(
        new Request("http://localhost/api/mcp", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-forwarded-for": testIp },
          body: JSON.stringify({ jsonrpc: "2.0", id: i, method: "tools/list" }),
        })
      );
      expect(res.status).toBe(200);
    }
    const limited = await runMcpTryIt({ tool: "search_tools", arguments: { query: "laser" } });
    expect(limited).toMatchObject({ ok: true, status: 429 });
    if (limited.ok) expect(JSON.stringify(limited.response)).toMatch(/too many requests/i);

    // A signed-in admin on the page is still the same anonymous IP bucket.
    await asAdminOnThePage();
    expect(await runMcpTryIt({ tool: "search_tools", arguments: { query: "laser" } })).toMatchObject({ status: 429 });
  });
});
