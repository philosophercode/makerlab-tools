// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- this suite reads the
   loosely-typed prompt and tool list a stub model recorded; precise typing
   here would add noise without value. */

// ── The model: stubbed at the job registry, never the provider ───────
// `languageModelFor("chat")` hands the route a MockLanguageModelV3 (gateway spec
// §10: nothing in a test knows the provider). The route runs for real —
// streamText, the tools, prepareStep — and the tests read what the model was
// sent from `recordedCalls`.
vi.mock("@/lib/ai/models", async (importOriginal) =>
  (await import("../../../../test/ai/models-stub")).stubModelsModule(await importOriginal())
);

// Mock fns shared between the factories and the tests. Declared via
// vi.hoisted so they exist when the (hoisted) vi.mock factories run.
const mocks = vi.hoisted(() => ({
  rateLimitAsync: vi.fn(),
  checkRateLimit: vi.fn(),
}));
const { checkRateLimit } = mocks;

// ── Mock the rate limiter (default: allowed, set in beforeEach) ──────
// The route calls the identity-keyed `checkRateLimit`; the rest of the module
// is kept real so `resolveIdentity`'s use of `getClientIp` still works. The
// tiered-ceiling behavior itself is covered in `rate-limit.route.test.ts`.
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    rateLimitAsync: mocks.rateLimitAsync,
    checkRateLimit: mocks.checkRateLimit,
    getClientIp: vi.fn(() => "1.2.3.4"),
  };
});

// No Notion mock: since Phase 3 nothing in this request path reads or writes
// Notion. `report_issue` files its ticket into the demo-seeded PGlite database
// and the assertions below read the row back out.

// next/cache is imported by catalog.ts ("use cache" / cacheTag / cacheLife).
vi.mock("next/cache", () => ({
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { eq, inArray } from "drizzle-orm";
import { http, HttpResponse } from "msw";
import { POST } from "@/app/api/chat/route";
import { manualSourceKey } from "@/lib/data/manual-archives";
import { getDb, resetDbForTests } from "@/lib/db/client";
import {
  attachments,
  maintenanceLogs,
  resources,
  tools as toolsTable,
  units,
} from "@/lib/db/schema/index";
import { resetAuthForTests } from "@/lib/auth/config";
import { server } from "../../../../test/msw/server";
import { signInAsNew } from "../../../../test/utils/session";
import {
  recordedCalls,
  resetModelStubs,
  scriptedModel,
  setLanguageModel,
  textModel,
  toolCallModel,
  type RecordedCall,
} from "../../../../test/ai/models-stub";

/**
 * The catalogue, the units and the resources all come from the demo-seeded
 * PGlite database `getDb()` hands out with `DATABASE_URL` unset — the two
 * tools `Form 4` (unit `Form 4 // A`) and `Trotec Speedy 400`. The seed carries
 * no maintenance logs and no PDF resources; the tests that need them write
 * them and clean up after themselves.
 */

/** Resource rows this file inserted, removed after each test. */
const insertedResourceIds: string[] = [];

async function toolId(slug: string): Promise<string> {
  const db = await getDb();
  const [row] = await db
    .select({ id: toolsTable.id })
    .from(toolsTable)
    .where(eq(toolsTable.slug, slug));
  return row.id;
}

async function unitId(label: string): Promise<string> {
  const db = await getDb();
  const [row] = await db
    .select({ id: units.id })
    .from(units)
    .where(eq(units.unitLabel, label));
  return row.id;
}

/** Add resources to a seeded tool (default: the Form 4). */
async function addResources(
  rows: Array<{ title: string; url?: string | null; published?: boolean; slug?: string }>
): Promise<void> {
  const db = await getDb();
  const values = await Promise.all(
    rows.map(async ({ slug = "form-4", ...row }) => ({
      toolId: await toolId(slug),
      type: "Manual",
      ...row,
    }))
  );
  const created = await db.insert(resources).values(values).returning({ id: resources.id });
  insertedResourceIds.push(...created.map((row) => row.id));
}

async function addMaintenanceLogs(
  label: string,
  rows: Array<Partial<typeof maintenanceLogs.$inferInsert>>
): Promise<void> {
  const db = await getDb();
  const id = await unitId(label);
  await db.insert(maintenanceLogs).values(rows.map((row) => ({ title: "Issue", unitId: id, ...row })));
}

function chatRequest(
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "1.2.3.4",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

/** The chat model this test's route will be handed. */
let model = textModel("Hello.");

function stubChatModel(next: typeof model): void {
  model = next;
  setLanguageModel("chat", next);
}

/**
 * POST and read the whole stream. The response is lazy: the model is called,
 * and the tools run, only as the body is consumed.
 */
async function send(
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): Promise<{ res: Response; text: string }> {
  const res = await POST(chatRequest(body, headers));
  const text = await res.text();
  return { res, text };
}

/** The first call the chat model received this test. */
function firstCall(): RecordedCall {
  const [call] = recordedCalls(model);
  if (!call) throw new Error("the chat model was never called");
  return call;
}

function systemOf(call: RecordedCall = firstCall()): string {
  const message = call.prompt.find((m) => m.role === "system");
  return typeof message?.content === "string" ? message.content : "";
}

function toolNamesOf(call: RecordedCall = firstCall()): string[] {
  return (call.tools ?? []).map((t) => t.name);
}

function firstUserOf(call: RecordedCall = firstCall()): any {
  return call.prompt.find((m) => m.role === "user");
}

/**
 * Run one capability tool the way the model would: the stub calls it, the SDK
 * executes it, and the result is read back from the model's second call.
 */
async function runTool(
  name: string,
  input: unknown,
  headers: Record<string, string> = {}
): Promise<any> {
  stubChatModel(toolCallModel([{ toolName: name, input }], "Done."));
  await send({ messages: [userMessage("hi")] }, headers);
  return toolResultOf(name);
}

/** The output of the `name` tool call, as the model's next call received it. */
function toolResultOf(name: string): any {
  const calls = recordedCalls(model);
  const toolMessage: any = calls[1]?.prompt.find((m) => m.role === "tool");
  const part = toolMessage?.content.find(
    (p: any) => p.type === "tool-result" && p.toolName === name
  );
  if (!part) throw new Error(`no ${name} result reached the model`);
  return part.output.type === "json" ? part.output.value : part.output;
}

/** Every key under a `providerOptions`, anywhere in `value`. */
function providerOptionKeys(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) providerOptionKeys(item, found);
    return found;
  }
  if (typeof value !== "object" || value === null) return found;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return found;
  for (const [key, child] of Object.entries(value)) {
    if (key === "providerOptions" && typeof child === "object" && child !== null) {
      for (const name of Object.keys(child)) found.add(name);
    }
    providerOptionKeys(child, found);
  }
  return found;
}

const userMessage = (text: string) => ({
  id: "1",
  role: "user" as const,
  parts: [{ type: "text" as const, text }],
});

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  resetAuthForTests();
  // Undo any `vi.stubGlobal("fetch", …)` from a prior PDF test (the shared
  // setup file does not call vi.unstubAllGlobals).
  vi.unstubAllGlobals();
  stubChatModel(textModel("Hello."));
  checkRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 59,
    limit: 60,
    windowMs: 60 * 60_000,
    retryAfterSeconds: 3600,
    role: "user",
  });
});

afterEach(async () => {
  resetModelStubs();
  const db = await getDb();
  await db.delete(maintenanceLogs);
  // The seed carries no attachments, so clearing the table only drops what a
  // test wrote.
  await db.delete(attachments);
  if (insertedResourceIds.length > 0) {
    await db.delete(resources).where(inArray(resources.id, insertedResourceIds));
    insertedResourceIds.length = 0;
  }
});

afterAll(() => {
  resetDbForTests();
});

describe("POST /api/chat — rate limiting", () => {
  it("returns 429 with Retry-After and never calls the model when denied", async () => {
    checkRateLimit.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      limit: 60,
      windowMs: 60 * 60_000,
      retryAfterSeconds: 3600,
      role: "student",
    });

    const res = await POST(chatRequest({ messages: [userMessage("hi")] }));

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("3600");
    const json = await res.json();
    expect(json.error).toMatch(/too many requests/i);
    expect(recordedCalls(model)).toHaveLength(0);
  });
});

describe("POST /api/chat — response", () => {
  it("streams the model's answer with status 200 on an allowed request", async () => {
    stubChatModel(textModel("The Form 4 is in the resin bench."));
    const { res, text } = await send({ messages: [userMessage("hi")] });
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(200);
    expect(text).toContain("The Form 4 is in the resin bench.");
    expect(recordedCalls(model)).toHaveLength(1);
    expect(firstCall().mode).toBe("stream");
  });

  it("names MODEL_CHAT, never its value, when the override is malformed", async () => {
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("MODEL_CHAT", "sk-live-not-a-model-id-1234");

    const { res, text } = await send({ messages: [userMessage("hi")] });

    expect(res.status).toBe(200);
    expect(text).toContain("The assistant's model is not available (MODEL_CHAT).");
    expect(text).not.toContain("sk-live");
    expect(recordedCalls(model)).toHaveLength(0);
    const logged = warned.mock.calls.flat().join(" ");
    expect(logged).toContain("MODEL_CHAT");
    expect(logged).not.toContain("sk-live");
  });
});

describe("POST /api/chat — system prompt", () => {
  it("includes the catalog header and a known mock tool name", async () => {
    await send({ messages: [userMessage("hi")] });

    const system = systemOf();
    expect(system).toContain("MakerLab catalog");
    expect(system).toContain("Form 4");
    expect(system).toContain("Trotec Speedy 400");
  });

  it("adds the Response language section naming Spanish when locale is 'es'", async () => {
    await send({ messages: [userMessage("hi")], locale: "es" });

    expect(systemOf()).toContain("Response language");
    expect(systemOf()).toContain("Spanish");
  });

  it("omits the Response language section when locale is omitted", async () => {
    await send({ messages: [userMessage("hi")] });
    expect(systemOf()).not.toContain("Response language");
  });

  it("omits the Response language section when locale is 'en'", async () => {
    await send({ messages: [userMessage("hi")], locale: "en" });
    expect(systemOf()).not.toContain("Response language");
  });

  it("describes exa_search and read_page, and no retired provider tool", async () => {
    await send({ messages: [userMessage("hi")], toolId: "form-4" });

    const system = systemOf();
    expect(system).toContain("`exa_search`");
    expect(system).toContain("`read_page`");
    expect(system).toMatch(/untrusted data/);
    expect(system).not.toContain("web_fetch");
    expect(system).not.toContain("web_search");
    expect(system).not.toMatch(/Claude|Anthropic/);
  });
});

describe("POST /api/chat — tools wired", () => {
  it("hands the model the capability tools, read_page, and Exa search through the Gateway", async () => {
    await send({ messages: [userMessage("hi")] });

    const names = toolNamesOf();
    expect(names).toEqual(expect.arrayContaining(["get_unit_details", "report_issue", "read_page", "exa_search"]));
    expect(names).not.toContain("web_fetch");
    expect(names).not.toContain("web_search");

    const exa = firstCall().tools?.find((t) => t.name === "exa_search");
    expect(exa).toMatchObject({
      type: "provider",
      id: "gateway.exa_search",
      args: { numResults: 5, contents: { highlights: true } },
    });
    expect(firstCall().tools?.find((t) => t.name === "read_page")).toMatchObject({ type: "function" });
  });

  it("sends no Anthropic provider option anywhere — prompt parts, tools or call options", async () => {
    await addResources([{ title: "Manual 1", url: "https://x.test/m1.pdf" }]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new TextEncoder().encode("%PDF-1.4\n"), { status: 200 }))
    );

    await send({ messages: [userMessage("how do I use this")], toolId: "form-4" });

    const call = firstCall();
    expect(call.prompt.some((m: any) => Array.isArray(m.content) && m.content.some((p: any) => p.type === "file"))).toBe(true);
    expect([...providerOptionKeys(call.options)]).not.toContain("anthropic");
    expect(JSON.stringify(call.tools)).not.toMatch(/anthropic/i);
  });

  it("stops offering read_page after five calls in one turn, and keeps everything else", async () => {
    // No focused tool, so each read_page call is refused without a fetch.
    stubChatModel(
      scriptedModel((i) =>
        i < 5
          ? {
              content: [
                {
                  type: "tool-call",
                  toolCallId: `call_${i}`,
                  toolName: "read_page",
                  input: JSON.stringify({ url: "https://example.com/sop" }),
                },
              ],
              finishReason: "tool-calls",
            }
          : { content: [{ type: "text", text: "I could not open that page." }], finishReason: "stop" }
      )
    );

    await send({ messages: [userMessage("read the SOP")] });

    const calls = recordedCalls(model);
    expect(calls).toHaveLength(6);
    for (const call of calls.slice(0, 5)) expect(toolNamesOf(call)).toContain("read_page");
    expect(toolNamesOf(calls[5])).not.toContain("read_page");
    expect(toolNamesOf(calls[5])).toEqual(expect.arrayContaining(["exa_search", "get_unit_details", "report_issue"]));
    expect(toolResultOf("read_page")).toMatchObject({ status: "refused", reason: "no_focused_tool" });
  });
});

describe("get_unit_details, run by the model", () => {
  it("returns { found:false } with a sample list for an unknown unit", async () => {
    const result = await runTool("get_unit_details", { unit_label: "no-such-unit" });
    expect(result.found).toBe(false);
    // Sample list drawn from the seeded catalogue's units.
    expect(result.message).toMatch(/Form 4 \/\/ A|Trotec Speedy 400/);
  });

  it("returns { found:true } with status/condition/detail_page for a real unit", async () => {
    const result = await runTool("get_unit_details", { unit_label: "Form 4 // A" });
    expect(result.found).toBe(true);
    expect(result.unit_label).toBe("Form 4 // A");
    expect(result.status).toBe("In Use");
    expect(result.condition).toBe("Excellent");
    expect(result.detail_page).toBe("/tools/form-4");
    expect(result.maintenance_logs).toEqual([]);
  });

  it("surfaces maintenance logs, capped at 10 and newest first", async () => {
    await addMaintenanceLogs(
      "Form 4 // A",
      Array.from({ length: 12 }, (_, i) => ({
        title: `Issue ${i}`,
        type: "issue_report",
        priority: "medium",
        status: "open",
        description: `desc ${i}`,
        dateReported: `2024-09-${String(i + 1).padStart(2, "0")}`,
      }))
    );

    const result = await runTool("get_unit_details", { unit_label: "Form 4 // A" });

    expect(result.found).toBe(true);
    expect(result.maintenance_logs).toHaveLength(10);
    // Stored snake_case, shown in the words the assistant has always seen.
    expect(result.maintenance_logs[0]).toMatchObject({
      title: "Issue 11",
      type: "Issue Report",
      priority: "Medium",
      status: "Open",
    });
  });
});

describe("report_issue, run by the model", () => {
  /** The ticket the tool call actually wrote. */
  async function ticket(id: string) {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(maintenanceLogs)
      .where(eq(maintenanceLogs.id, id));
    return row;
  }

  it("writes an open issue_report and returns its id", async () => {
    const result = await runTool("report_issue", {
      title: "Bed not leveling",
      description: "The print bed will not auto-level.",
      priority: "Medium",
    });

    expect(result.success).toBe(true);
    const row = await ticket(result.ticket_id);
    expect(row).toMatchObject({
      title: "Bed not leveling",
      type: "issue_report",
      priority: "medium",
      status: "open",
    });
  });

  it("links the resolved unit when a known unit_label is supplied", async () => {
    const result = await runTool("report_issue", {
      title: "Resin leak",
      description: "Leaking resin",
      unit_label: "Form 4 // A",
      priority: "High",
    });

    // The catalogue id and the ticket's `unit_id` are the same Postgres uuid —
    // there is no translation left between them.
    const form4A = await unitId("Form 4 // A");
    expect(result.success).toBe(true);
    expect(result.unit_resolved).toEqual({ id: form4A, label: "Form 4 // A" });
    expect((await ticket(result.ticket_id)).unitId).toBe(form4A);
  });

  it("records the verified session name and email for a signed-in user", async () => {
    // The end-to-end proof of the pass-through: a real session row and the
    // cookie that addresses it, through resolveIdentity, onto the
    // CapabilityCtx, into the write.
    vi.stubEnv("AUTH_SECRET", "chat-route-test-secret");
    resetAuthForTests();
    const reporter = await signInAsNew({
      email: "ada@cornell.edu",
      name: "Ada Lovelace",
    });

    const result = await runTool(
      "report_issue",
      {
        title: "Resin leak",
        description: "Leaking resin",
        priority: "High",
        reported_by: "Somebody Else",
      },
      { cookie: reporter.cookie }
    );

    // The assistant is told who it is talking to, and told not to ask.
    expect(systemOf()).toContain("Ada Lovelace");
    expect(systemOf()).not.toContain("ada@cornell.edu");
    expect(await ticket(result.ticket_id)).toMatchObject({
      reportedByName: "Ada Lovelace",
      reportedByEmail: "ada@cornell.edu",
      reportedByUserId: reporter.user.id,
    });
  });

  it("records no email and the supplied name for an anonymous reporter", async () => {
    const result = await runTool("report_issue", {
      title: "Resin leak",
      description: "Leaking resin",
      priority: "High",
      reported_by: "Grace Hopper",
    });

    const row = await ticket(result.ticket_id);
    expect(row.reportedByName).toBe("Grace Hopper");
    expect(row.reportedByEmail).toBeNull();
  });

  it("returns { success:false, error } when the write fails, and files nothing", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    // A configured database nobody can reach — the case that must never come
    // back as "logged your ticket". Switched on as the model calls the tool,
    // after the route has read the catalogue.
    stubChatModel(
      scriptedModel((i) => {
        if (i > 0) return { content: [{ type: "text", text: "Sorry." }], finishReason: "stop" };
        vi.stubEnv("DATABASE_URL", "postgres://user:hunter2@127.0.0.1:1/none");
        resetDbForTests();
        return {
          content: [
            {
              type: "tool-call",
              toolCallId: "call_1",
              toolName: "report_issue",
              input: JSON.stringify({ title: "Broken", description: "It is broken", priority: "Low" }),
            },
          ],
          finishReason: "tool-calls",
        };
      })
    );

    await send({ messages: [userMessage("hi")] });
    const result = toolResultOf("report_issue");

    expect(result.success).toBe(false);
    expect(result.ticket_id).toBeUndefined();
    expect(result.error).not.toMatch(/hunter2|postgres|ECONNREFUSED/i);
    expect(logged).toHaveBeenCalled();

    // Put the demo substrate back before the file's own cleanup runs: the
    // stub is still in force until vitest's global afterEach clears it.
    vi.stubEnv("DATABASE_URL", "");
    resetDbForTests();
  });
});

describe("PDF manual collection (focused tool)", () => {
  const PDF_SMALL = new TextEncoder().encode("%PDF-1.4\n% a small manual\n");
  const TEN_MB_PLUS = 10 * 1024 * 1024 + 1;

  /**
   * Answer each `url` over MSW — the resource's own link is fetched through
   * the SSRF guard, which reads a real `Response` — and record the hits.
   */
  function servePdfs(urls: Record<string, () => Response>): string[] {
    const hits: string[] = [];
    server.use(
      ...Object.entries(urls).map(([url, respond]) =>
        http.get(url, ({ request }) => {
          hits.push(request.url);
          return respond();
        })
      )
    );
    return hits;
  }

  function pdfResponse(bytes: Uint8Array = PDF_SMALL): Response {
    return HttpResponse.arrayBuffer(bytes.slice().buffer, { headers: { "content-type": "application/pdf" } });
  }

  function okPdf(bytes: Uint8Array | number) {
    const body =
      typeof bytes === "number" ? new Uint8Array(bytes) : bytes;
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => body.buffer,
    } as unknown as Response;
  }

  function fileParts(): any[] {
    return (firstUserOf().content as any[]).filter((p) => p.type === "file");
  }

  it("attaches small PDFs to the first user message as plain file parts, and caps at 3", async () => {
    await addResources([
      { title: "Manual 1", url: "https://x.test/m1.pdf" },
      { title: "Manual 2", url: "https://x.test/m2.pdf" },
      { title: "Manual 3", url: "https://x.test/m3.pdf" },
      { title: "Manual 4", url: "https://x.test/m4.pdf" },
    ]);

    const hits = servePdfs(
      Object.fromEntries([1, 2, 3, 4].map((n) => [`https://x.test/m${n}.pdf`, () => pdfResponse()]))
    );

    await send({ messages: [userMessage("how do I use this")], toolId: "form-4" });

    // Cap of 3 PDFs: only 3 fetched, only 3 attached.
    expect(hits).toHaveLength(3);

    const parts = fileParts();
    expect(parts).toHaveLength(3);
    for (const part of parts) {
      // Provider-neutral: no cache markers, no options for any provider (spec §3.4).
      expect(part).toMatchObject({ mediaType: "application/pdf", filename: expect.stringMatching(/\.pdf$/) });
      expect(part.providerOptions).toBeUndefined();
    }

    // System prompt lists the attached manuals.
    expect(systemOf()).toContain("## Available manuals");
    expect(systemOf()).toContain("Manual 1");
  });

  it("skips PDFs that are too large or return non-ok, and skips non-PDF resources", async () => {
    await addResources([
      { title: "Good", url: "https://x.test/good.pdf" },
      { title: "Huge", url: "https://x.test/huge.pdf" },
      { title: "Dead", url: "https://x.test/dead.pdf" },
      // Non-PDF url → skipped entirely (never fetched).
      { title: "Webpage", url: "https://x.test/page.html" },
    ]);

    const huge = new Uint8Array(TEN_MB_PLUS);
    huge.set(PDF_SMALL);
    const fetchedUrls = servePdfs({
      "https://x.test/good.pdf": () => pdfResponse(),
      "https://x.test/huge.pdf": () => pdfResponse(huge),
      "https://x.test/dead.pdf": () => new HttpResponse(null, { status: 404 }),
      "https://x.test/page.html": () => HttpResponse.html("<p>never fetched</p>"),
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await send({ messages: [userMessage("help")], toolId: "form-4" });

    // The .html resource is never fetched (not a PDF url).
    expect(fetchedUrls).not.toContain("https://x.test/page.html");
    expect(fetchedUrls).toEqual(
      expect.arrayContaining([
        "https://x.test/good.pdf",
        "https://x.test/huge.pdf",
        "https://x.test/dead.pdf",
      ])
    );

    // Only the small "Good" PDF actually attaches.
    expect(fileParts()).toHaveLength(1);
    expect(systemOf()).toContain("Good");
  });

  it("never follows a manual link that redirects inward, and attaches nothing from it", async () => {
    // Research verified this link as public; now its host bounces the chat's
    // server-side download to the cloud metadata service.
    await addResources([{ title: "Evil manual", url: "https://attacker.example/manual.pdf" }]);
    let metadataHit = false;
    server.use(
      http.get("https://attacker.example/manual.pdf", () =>
        new HttpResponse(null, { status: 302, headers: { Location: "http://169.254.169.254/latest/meta-data/" } })
      ),
      http.get("http://169.254.169.254/latest/meta-data/", () => {
        metadataHit = true;
        return pdfResponse();
      })
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await send({ messages: [userMessage("help")], toolId: "form-4" });

    expect(metadataHit).toBe(false);
    expect(fileParts()).toHaveLength(0);
    expect(warn.mock.calls.map((call) => call.join(" ")).join("\n")).toContain("blocked");
  });

  it("attaches nothing that is not a PDF, whatever its content type says", async () => {
    await addResources([{ title: "Fake manual", url: "https://x.test/fake.pdf" }]);
    servePdfs({
      "https://x.test/fake.pdf": () =>
        new HttpResponse("root:x:0:0:root:/root:/bin/bash", { headers: { "content-type": "application/pdf" } }),
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await send({ messages: [userMessage("help")], toolId: "form-4" });

    expect(fileParts()).toHaveLength(0);
  });

  it("ignores unpublished resources and resources for other tools", async () => {
    await addResources([
      { title: "Unpublished", url: "https://x.test/u.pdf", published: false },
      { title: "OtherTool", url: "https://x.test/o.pdf", slug: "trotec-speedy-400" },
    ]);
    const fetchMock = vi.fn(async () => okPdf(PDF_SMALL));
    vi.stubGlobal("fetch", fetchMock);

    await send({ messages: [userMessage("help")], toolId: "form-4" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(systemOf()).not.toContain("## Available manuals");
  });

  it("attaches a resource's uploaded file when the resource itself has no url", async () => {
    await addResources([{ title: "Scanned manual", url: null }]);
    const db = await getDb();
    const [scanned] = await db
      .select({ id: resources.id })
      .from(resources)
      .where(eq(resources.title, "Scanned manual"));
    await db.insert(attachments).values({
      ownerType: "resource",
      ownerId: scanned.id,
      blobPathname: "resources/scanned-abc123.pdf",
      access: "public",
      publicUrl: "https://blob.test/resources/scanned-abc123.pdf",
    });

    const fetchMock = vi.fn(async () => okPdf(PDF_SMALL));
    vi.stubGlobal("fetch", fetchMock);

    await send({ messages: [userMessage("help")], toolId: "form-4" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://blob.test/resources/scanned-abc123.pdf",
      expect.anything()
    );
    expect(systemOf()).toContain("Scanned manual");
  });

  it("attaches the archived copy instead of the manufacturer's link, once, and marks it attached", async () => {
    const SOURCE = "https://maker.test/support/form-4-manual";
    const ARCHIVE = "https://blob.test/manuals/form-4/manual-abc.pdf";
    await addResources([{ title: "Form 4 manual", url: SOURCE }]);
    const id = insertedResourceIds[insertedResourceIds.length - 1];
    const db = await getDb();
    await db.insert(attachments).values({
      ownerType: "resource",
      ownerId: id,
      blobPathname: "manuals/form-4/manual-abc.pdf",
      access: "public",
      publicUrl: ARCHIVE,
      contentType: "application/pdf",
      sourceKey: manualSourceKey(id, SOURCE),
    });

    const fetched: string[] = [];
    server.use(
      http.get(ARCHIVE, ({ request }) => {
        fetched.push(request.url);
        return HttpResponse.arrayBuffer(new TextEncoder().encode("%PDF-1.4\n").buffer, {
          headers: { "content-type": "application/pdf" },
        });
      })
      // No handler for SOURCE: fetching it would fail the test.
    );

    await send({ messages: [userMessage("help")], toolId: "form-4" });

    expect(fetched).toEqual([ARCHIVE]);
    expect(fileParts()).toHaveLength(1);
    const system = systemOf();
    expect(system).toContain(`${ARCHIVE} (attached)`);
    // One line for the one manual in the annotated list — the copy and the
    // source are not listed as two resources.
    const annotated = system.slice(system.indexOf("## Attached manuals vs. readable resources"));
    expect(annotated.split("\n").filter((line) => line.includes("Form 4 manual"))).toEqual([
      `- [Manual] Form 4 manual — ${ARCHIVE} (attached)`,
    ]);
    // The fallback for what is not attached is read_page on a link, never a provider tool.
    expect(annotated).toContain("`read_page`");
    expect(annotated).not.toContain("web_fetch");
  });

  it("does not run manual collection when no toolId is provided", async () => {
    await addResources([{ title: "Manual 1", url: "https://x.test/m1.pdf" }]);
    const fetchMock = vi.fn(async () => okPdf(PDF_SMALL));
    vi.stubGlobal("fetch", fetchMock);

    await send({ messages: [userMessage("hi")] });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(systemOf()).not.toContain("## Available manuals");
  });
});

// ── Adding equipment needs `tools.add` (spec §3.5) ───────────────────
describe("POST /api/chat — who may add equipment", () => {
  const INTAKE_TOOLS = ["identify_tools"];
  /** Gone from the chat: two retired in Phase 6, one moved to MCP only. */
  const NEVER_IN_CHAT = ["create_tool", "research_tool", "propose_listing"];
  const SECRET = "chat-route-test-secret";
  const ASK = "I'd like to add new equipment to the inventory.";

  /** Post as a seeded session in `role`. No Google, no env roster. */
  async function postAs(role: "user" | "admin" | "super_admin", name: string) {
    vi.stubEnv("AUTH_SECRET", SECRET);
    resetAuthForTests();
    const { cookie } = await signInAsNew({ role, name });
    await send({ messages: [userMessage(ASK)] }, { cookie });
  }

  it("gives an anonymous visitor no intake tools, and tells the assistant why", async () => {
    await send({ messages: [userMessage(ASK)] });

    for (const name of INTAKE_TOOLS) {
      expect(toolNamesOf()).not.toContain(name);
    }
    expect(systemOf()).toContain("limited to lab staff");
    expect(systemOf()).not.toContain("act as an intake agent");
  });

  it("gives an ordinary signed-in user no intake tools either", async () => {
    await postAs("user", "Ada Lovelace");

    for (const name of INTAKE_TOOLS) {
      expect(toolNamesOf()).not.toContain(name);
    }
    expect(systemOf()).toContain("limited to lab staff");
  });

  it("gives an admin the intake tools and the full intake instructions", async () => {
    // The role comes from the `user` row. `AUTH_STAFF_EMAILS` is retired.
    await postAs("admin", "Niti Parikh");

    for (const name of INTAKE_TOOLS) {
      expect(toolNamesOf()).toContain(name);
    }
    expect(systemOf()).toContain("act as an intake agent");
    expect(systemOf()).not.toContain("limited to lab staff");
  });

  it("never gives even an admin create_tool, research_tool or propose_listing", async () => {
    // Research is a button and approval is a page (spec §3.6, §5.4); the model
    // can identify equipment and nothing else.
    await postAs("admin", "Niti Parikh");

    for (const name of NEVER_IN_CHAT) {
      expect(toolNamesOf()).not.toContain(name);
    }
  });

  it("keeps reporting a problem open to anonymous visitors", async () => {
    await send({ messages: [userMessage("the printer is jammed")] });
    expect(toolNamesOf()).toContain("report_issue");
  });
});

// ── Photos reach the model (intake spec §6.1) ────────────────────────
describe("POST /api/chat — photos reach the model", () => {
  it("passes an attached photo to the model on the user message", async () => {
    await send({
      messages: [
        {
          id: "1",
          role: "user",
          parts: [
            {
              type: "text",
              text: "what printer is this?\n\n[Attached photos: attachment_id=3f2504e0-4f89-41d3-9a0c-0305e82c3301 name=plate.jpg]",
            },
            {
              type: "file",
              mediaType: "image/jpeg",
              filename: "plate.jpg",
              url: "data:image/jpeg;base64,AAAA",
            },
          ],
        },
      ],
    });

    const image = (firstUserOf().content as any[]).find((p) => p.type === "file");
    expect(image).toMatchObject({ mediaType: "image/jpeg" });
    // The SDK hands the model the data URL's bytes, as bytes or as base64.
    const bytes = image.data instanceof Uint8Array ? image.data : Buffer.from(String(image.data), "base64");
    expect(Buffer.from(bytes).toString("base64")).toBe("AAAA");
  });

  it("still shows the model a photo whose hint entry is malformed", async () => {
    // The hint is assembled by the client and re-sent verbatim on every turn,
    // so a truncated one must degrade to "no id" rather than throwing the
    // request away — the model can still look at the picture.
    const { res } = await send({
      messages: [
        {
          id: "1",
          role: "user",
          parts: [
            {
              type: "text",
              text: "what is this?\n\n[Attached photos: name=plate.jpg; attachment_id=]",
            },
            {
              type: "file",
              mediaType: "image/jpeg",
              filename: "plate.jpg",
              url: "data:image/jpeg;base64,AAAA",
            },
          ],
        },
      ],
    });

    expect(res.status).toBe(200);
    expect(firstUserOf().content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "file", mediaType: "image/jpeg" }),
      ])
    );
  });
});
