// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- this suite inspects the
   loosely-typed { system, messages, tools } object captured from the mocked
   streamText call; precise typing here would add noise without value. */

// ── Captured streamText args ─────────────────────────────────────────
// streamText is mocked so we can inspect the { system, messages, tools }
// the route hands the model, and invoke the inline tool.execute fns directly.
const captured: { args?: any } = {};

// ── Mock @ai-sdk/anthropic (model factory + web_fetch tool) ──────────
vi.mock("@ai-sdk/anthropic", () => {
  const anthropic = Object.assign(
    vi.fn(() => ({ modelId: "mock-model" })),
    {
      tools: {
        webFetch_20250910: vi.fn(() => ({ type: "web_fetch_mock" })),
        webSearch_20250305: vi.fn(() => ({ type: "web_search_mock" })),
      },
    }
  );
  return { anthropic };
});

// ── Mock ai: keep everything real except streamText ──────────────────
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: vi.fn((args: unknown) => {
      captured.args = args;
      return {
        toUIMessageStream: () =>
          new ReadableStream({
            start(c) {
              c.close();
            },
          }),
      };
    }),
  };
});

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
import { POST } from "@/app/api/chat/route";
import { getDb, resetDbForTests } from "@/lib/db/client";
import {
  attachments,
  maintenanceLogs,
  resources,
  tools as toolsTable,
  units,
} from "@/lib/db/schema/index";
import { resetAuthForTests } from "@/lib/auth/config";
import { signInAsNew } from "../../../../test/utils/session";

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

const userMessage = (text: string) => ({
  id: "1",
  role: "user" as const,
  parts: [{ type: "text" as const, text }],
});

beforeEach(() => {
  captured.args = undefined;
  vi.stubEnv("DATABASE_URL", "");
  resetAuthForTests();
  // Undo any `vi.stubGlobal("fetch", …)` from a prior PDF test (the shared
  // setup file does not call vi.unstubAllGlobals).
  vi.unstubAllGlobals();
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
  it("returns 429 with Retry-After and never calls streamText when denied", async () => {
    checkRateLimit.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      limit: 60,
      windowMs: 60 * 60_000,
      retryAfterSeconds: 3600,
      role: "student",
    });

    const { streamText } = await import("ai");
    const res = await POST(chatRequest({ messages: [userMessage("hi")] }));

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("3600");
    const json = await res.json();
    expect(json.error).toMatch(/too many requests/i);
    expect(vi.mocked(streamText)).not.toHaveBeenCalled();
  });
});

describe("POST /api/chat — response", () => {
  it("returns a streamed Response with status 200 on an allowed request", async () => {
    const res = await POST(chatRequest({ messages: [userMessage("hi")] }));
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(200);
  });
});

describe("POST /api/chat — system prompt", () => {
  it("includes the catalog header and a known mock tool name", async () => {
    await POST(chatRequest({ messages: [userMessage("hi")] }));

    expect(typeof captured.args.system).toBe("string");
    expect(captured.args.system).toContain("MakerLab catalog");
    expect(captured.args.system).toContain("Form 4");
    expect(captured.args.system).toContain("Trotec Speedy 400");
  });

  it("adds the Response language section naming Spanish when locale is 'es'", async () => {
    await POST(chatRequest({ messages: [userMessage("hi")], locale: "es" }));

    expect(captured.args.system).toContain("Response language");
    expect(captured.args.system).toContain("Spanish");
  });

  it("omits the Response language section when locale is omitted", async () => {
    await POST(chatRequest({ messages: [userMessage("hi")] }));
    expect(captured.args.system).not.toContain("Response language");
  });

  it("omits the Response language section when locale is 'en'", async () => {
    await POST(chatRequest({ messages: [userMessage("hi")], locale: "en" }));
    expect(captured.args.system).not.toContain("Response language");
  });
});

describe("POST /api/chat — tools wired", () => {
  it("exposes get_unit_details, report_issue, and web_fetch", async () => {
    await POST(chatRequest({ messages: [userMessage("hi")] }));

    expect(captured.args.tools).toHaveProperty("get_unit_details");
    expect(captured.args.tools).toHaveProperty("report_issue");
    expect(captured.args.tools).toHaveProperty("web_fetch");
  });
});

describe("get_unit_details.execute", () => {
  async function getTools() {
    await POST(chatRequest({ messages: [userMessage("hi")] }));
    return captured.args.tools;
  }

  it("returns { found:false } with a sample list for an unknown unit", async () => {
    const tools = await getTools();
    const result = await tools.get_unit_details.execute({
      unit_label: "no-such-unit",
    });
    expect(result.found).toBe(false);
    // Sample list drawn from the seeded catalogue's units.
    expect(result.message).toMatch(/Form 4 \/\/ A|Trotec Speedy 400/);
  });

  it("returns { found:true } with status/condition/detail_page for a real unit", async () => {
    const tools = await getTools();
    const result = await tools.get_unit_details.execute({
      unit_label: "Form 4 // A",
    });
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

    const tools = await getTools();
    const result = await tools.get_unit_details.execute({
      unit_label: "Form 4 // A",
    });

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

describe("report_issue.execute", () => {
  async function getTools() {
    await POST(chatRequest({ messages: [userMessage("hi")] }));
    return captured.args.tools;
  }

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
    const tools = await getTools();
    const result = await tools.report_issue.execute({
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
    const tools = await getTools();
    const result = await tools.report_issue.execute({
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

    await POST(
      chatRequest({ messages: [userMessage("hi")] }, { cookie: reporter.cookie })
    );
    // The assistant is told who it is talking to, and told not to ask.
    expect(captured.args.system).toContain("Ada Lovelace");
    expect(captured.args.system).not.toContain("ada@cornell.edu");

    const result = await captured.args.tools.report_issue.execute({
      title: "Resin leak",
      description: "Leaking resin",
      priority: "High",
      reported_by: "Somebody Else",
    });

    expect(await ticket(result.ticket_id)).toMatchObject({
      reportedByName: "Ada Lovelace",
      reportedByEmail: "ada@cornell.edu",
      reportedByUserId: reporter.user.id,
    });
  });

  it("records no email and the supplied name for an anonymous reporter", async () => {
    const tools = await getTools();
    const result = await tools.report_issue.execute({
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
    const tools = await getTools();
    // A configured database nobody can reach — the case that must never come
    // back as "logged your ticket".
    vi.stubEnv("DATABASE_URL", "postgres://user:hunter2@127.0.0.1:1/none");
    resetDbForTests();

    const result = await tools.report_issue.execute({
      title: "Broken",
      description: "It is broken",
      priority: "Low",
    });

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
  const PDF_SMALL = new Uint8Array([1, 2, 3, 4]);
  const TEN_MB_PLUS = 10 * 1024 * 1024 + 1;

  function okPdf(bytes: Uint8Array | number) {
    const body =
      typeof bytes === "number" ? new Uint8Array(bytes) : bytes;
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => body.buffer,
    } as unknown as Response;
  }

  it("attaches small PDFs to the first user message and caps at 3", async () => {
    await addResources([
      { title: "Manual 1", url: "https://x.test/m1.pdf" },
      { title: "Manual 2", url: "https://x.test/m2.pdf" },
      { title: "Manual 3", url: "https://x.test/m3.pdf" },
      { title: "Manual 4", url: "https://x.test/m4.pdf" },
    ]);

    const fetchMock = vi.fn(async () => okPdf(PDF_SMALL));
    vi.stubGlobal("fetch", fetchMock);

    await POST(
      chatRequest({ messages: [userMessage("how do I use this")], toolId: "form-4" })
    );

    // Cap of 3 PDFs: only 3 fetched, only 3 attached.
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const msgs = captured.args.messages;
    const firstUser = msgs.find((m: any) => m.role === "user");
    const fileParts = (firstUser.content as any[]).filter(
      (p) => p.type === "file"
    );
    expect(fileParts).toHaveLength(3);
    expect(fileParts[0]).toMatchObject({ mediaType: "application/pdf" });

    // System prompt lists the attached manuals.
    expect(captured.args.system).toContain("Available manuals");
    expect(captured.args.system).toContain("Manual 1");
  });

  it("skips PDFs that are too large or return non-ok, and skips non-PDF resources", async () => {
    await addResources([
      { title: "Good", url: "https://x.test/good.pdf" },
      { title: "Huge", url: "https://x.test/huge.pdf" },
      { title: "Dead", url: "https://x.test/dead.pdf" },
      // Non-PDF url → skipped entirely (never fetched).
      { title: "Webpage", url: "https://x.test/page.html" },
    ]);

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("huge")) return okPdf(TEN_MB_PLUS);
      if (url.includes("dead"))
        return { ok: false, status: 404 } as unknown as Response;
      return okPdf(PDF_SMALL);
    });
    vi.stubGlobal("fetch", fetchMock);

    await POST(
      chatRequest({ messages: [userMessage("help")], toolId: "form-4" })
    );

    // The .html resource is never fetched (not a PDF url).
    const fetchedUrls = fetchMock.mock.calls.map((c) => c[0]);
    expect(fetchedUrls).not.toContain("https://x.test/page.html");
    expect(fetchedUrls).toEqual(
      expect.arrayContaining([
        "https://x.test/good.pdf",
        "https://x.test/huge.pdf",
        "https://x.test/dead.pdf",
      ])
    );

    // Only the small "Good" PDF actually attaches.
    const firstUser = captured.args.messages.find(
      (m: any) => m.role === "user"
    );
    const fileParts = (firstUser.content as any[]).filter(
      (p) => p.type === "file"
    );
    expect(fileParts).toHaveLength(1);
    expect(captured.args.system).toContain("Good");
  });

  it("ignores unpublished resources and resources for other tools", async () => {
    await addResources([
      { title: "Unpublished", url: "https://x.test/u.pdf", published: false },
      { title: "OtherTool", url: "https://x.test/o.pdf", slug: "trotec-speedy-400" },
    ]);
    const fetchMock = vi.fn(async () => okPdf(PDF_SMALL));
    vi.stubGlobal("fetch", fetchMock);

    await POST(
      chatRequest({ messages: [userMessage("help")], toolId: "form-4" })
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(captured.args.system).not.toContain("Available manuals");
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

    await POST(
      chatRequest({ messages: [userMessage("help")], toolId: "form-4" })
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://blob.test/resources/scanned-abc123.pdf",
      expect.anything()
    );
    expect(captured.args.system).toContain("Scanned manual");
  });

  it("does not run manual collection when no toolId is provided", async () => {
    await addResources([{ title: "Manual 1", url: "https://x.test/m1.pdf" }]);
    const fetchMock = vi.fn(async () => okPdf(PDF_SMALL));
    vi.stubGlobal("fetch", fetchMock);

    await POST(chatRequest({ messages: [userMessage("hi")] }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(captured.args.system).not.toContain("Available manuals");
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
    await POST(chatRequest({ messages: [userMessage(ASK)] }, { cookie }));
  }

  it("gives an anonymous visitor no intake tools, and tells the assistant why", async () => {
    await POST(chatRequest({ messages: [userMessage(ASK)] }));

    for (const name of INTAKE_TOOLS) {
      expect(captured.args.tools).not.toHaveProperty(name);
    }
    expect(captured.args.system).toContain("limited to lab staff");
    expect(captured.args.system).not.toContain("act as an intake agent");
  });

  it("gives an ordinary signed-in user no intake tools either", async () => {
    await postAs("user", "Ada Lovelace");

    for (const name of INTAKE_TOOLS) {
      expect(captured.args.tools).not.toHaveProperty(name);
    }
    expect(captured.args.system).toContain("limited to lab staff");
  });

  it("gives an admin the intake tools and the full intake instructions", async () => {
    // The role comes from the `user` row. `AUTH_STAFF_EMAILS` is retired.
    await postAs("admin", "Niti Parikh");

    for (const name of INTAKE_TOOLS) {
      expect(captured.args.tools).toHaveProperty(name);
    }
    expect(captured.args.system).toContain("act as an intake agent");
    expect(captured.args.system).not.toContain("limited to lab staff");
  });

  it("never gives even an admin create_tool, research_tool or propose_listing", async () => {
    // Research is a button and approval is a page (spec §3.6, §5.4); the model
    // can identify equipment and nothing else.
    await postAs("admin", "Niti Parikh");

    for (const name of NEVER_IN_CHAT) {
      expect(captured.args.tools).not.toHaveProperty(name);
    }
  });

  it("keeps reporting a problem open to anonymous visitors", async () => {
    await POST(chatRequest({ messages: [userMessage("the printer is jammed")] }));
    expect(captured.args.tools).toHaveProperty("report_issue");
  });
});

// ── Photos reach the model (intake spec §6.1) ────────────────────────
describe("POST /api/chat — photos reach the model", () => {
  it("passes an attached photo to the model on the user message", async () => {
    await POST(
      chatRequest({
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
      })
    );

    const user = captured.args.messages.find((m: any) => m.role === "user");
    expect(user.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "file",
          mediaType: "image/jpeg",
          data: "data:image/jpeg;base64,AAAA",
        }),
      ])
    );
  });

  it("still shows the model a photo whose hint entry is malformed", async () => {
    // The hint is assembled by the client and re-sent verbatim on every turn,
    // so a truncated one must degrade to "no id" rather than throwing the
    // request away — the model can still look at the picture.
    const res = await POST(
      chatRequest({
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
      })
    );

    expect(res.status).toBe(200);
    const user = captured.args.messages.find((m: any) => m.role === "user");
    expect(user.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "file", mediaType: "image/jpeg" }),
      ])
    );
  });
});
