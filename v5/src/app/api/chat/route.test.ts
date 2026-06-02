/* eslint-disable @typescript-eslint/no-explicit-any -- this suite inspects the
   loosely-typed { system, messages, tools } object captured from the mocked
   streamText call; precise typing here would add noise without value. */
import type { MaintenanceLogRecord, ResourceRecord } from "@/lib/types";

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
  fetchMaintenanceLogsByUnit: vi.fn(),
  createMaintenanceLog: vi.fn(),
  fetchAllResources: vi.fn(),
}));
const {
  rateLimitAsync,
  fetchMaintenanceLogsByUnit,
  createMaintenanceLog,
  fetchAllResources,
} = mocks;

// ── Mock the rate limiter (default: allowed, set in beforeEach) ──────
vi.mock("@/lib/rate-limit", () => ({
  rateLimitAsync: mocks.rateLimitAsync,
  getClientIp: vi.fn(() => "1.2.3.4"),
}));

// ── Mock Notion calls used by the route's tools / manual collection ──
vi.mock("@/lib/notion", () => ({
  fetchMaintenanceLogsByUnit: mocks.fetchMaintenanceLogsByUnit,
  createMaintenanceLog: mocks.createMaintenanceLog,
  fetchAllResources: mocks.fetchAllResources,
  // catalog.ts also imports from notion.ts, but with NOTION_* env unset the
  // catalog uses the mock fallback and never touches these, so stub the rest.
  getNotionEnvContract: () => [
    "NOTION_API_KEY",
    "NOTION_DB_TOOLS",
    "NOTION_DB_CATEGORIES",
    "NOTION_DB_LOCATIONS",
    "NOTION_DB_UNITS",
    "NOTION_DB_RESOURCES",
    "NOTION_DB_MAINTENANCE_LOGS",
    "NOTION_DB_FLAGS",
  ],
  fetchAllTools: vi.fn(async () => []),
  fetchAllCategories: vi.fn(async () => []),
  fetchAllLocations: vi.fn(async () => []),
  fetchAllUnits: vi.fn(async () => []),
  resolveTools: vi.fn(() => []),
}));

// next/cache is imported by catalog.ts ("use cache" / cacheTag / cacheLife).
vi.mock("next/cache", () => ({
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { POST } from "@/app/api/chat/route";

// A mock-catalog resource fixture builder (mirrors ResourceRecord shape).
function resource(
  partial: Partial<ResourceRecord["fields"]> & { id?: string }
): ResourceRecord {
  const { id = "res-1", ...fields } = partial;
  return {
    id,
    createdTime: "2024-01-01T00:00:00.000Z",
    lastEditedTime: "2024-01-01T00:00:00.000Z",
    fields: {
      title: "Manual",
      tool: ["tool-form-4"],
      published: true,
      ...fields,
    },
  } as ResourceRecord;
}

function chatRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "1.2.3.4",
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
  // Undo any `vi.stubGlobal("fetch", …)` from a prior PDF test (the shared
  // setup file does not call vi.unstubAllGlobals).
  vi.unstubAllGlobals();
  rateLimitAsync.mockResolvedValue({
    allowed: true,
    remaining: 19,
    limit: 20,
    reset: Date.now() + 60_000,
  });
  fetchMaintenanceLogsByUnit.mockReset();
  fetchMaintenanceLogsByUnit.mockResolvedValue([]);
  fetchAllResources.mockReset();
  fetchAllResources.mockResolvedValue([]);
  createMaintenanceLog.mockReset();
});

describe("POST /api/chat — rate limiting", () => {
  it("returns 429 with Retry-After and never calls streamText when denied", async () => {
    rateLimitAsync.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      limit: 20,
      reset: Date.now() + 60_000,
    });

    const { streamText } = await import("ai");
    const res = await POST(chatRequest({ messages: [userMessage("hi")] }));

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
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
    // Sample list drawn from the mock catalog's units.
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

  it("surfaces maintenance logs, sliced to 10", async () => {
    const logs: MaintenanceLogRecord[] = Array.from({ length: 12 }, (_, i) => ({
      id: `log-${i}`,
      createdTime: "2024-01-01T00:00:00.000Z",
      lastEditedTime: "2024-01-01T00:00:00.000Z",
      fields: {
        title: `Issue ${i}`,
        type: "Issue Report",
        priority: "Medium",
        status: "Open",
        date_reported: "2024-09-01",
        description: `desc ${i}`,
      },
    })) as MaintenanceLogRecord[];
    fetchMaintenanceLogsByUnit.mockResolvedValueOnce(logs);

    const tools = await getTools();
    const result = await tools.get_unit_details.execute({
      unit_label: "Form 4 // A",
    });

    expect(result.found).toBe(true);
    expect(result.maintenance_logs).toHaveLength(10);
    expect(result.maintenance_logs[0]).toMatchObject({
      title: "Issue 0",
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

  it("returns { success:true, ticket_id } when createMaintenanceLog resolves", async () => {
    createMaintenanceLog.mockResolvedValueOnce({
      id: "created-page-1",
      createdTime: "2024-09-01T10:00:00.000Z",
      lastEditedTime: "2024-09-01T10:00:00.000Z",
      fields: { title: "Bed not leveling" },
    });

    const tools = await getTools();
    const result = await tools.report_issue.execute({
      title: "Bed not leveling",
      description: "The print bed will not auto-level.",
      priority: "Medium",
    });

    expect(result.success).toBe(true);
    expect(result.ticket_id).toBe("created-page-1");
    expect(createMaintenanceLog).toHaveBeenCalledTimes(1);
    expect(createMaintenanceLog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Bed not leveling",
        type: "Issue Report",
        status: "Open",
      })
    );
  });

  it("links the resolved unit when a known unit_label is supplied", async () => {
    createMaintenanceLog.mockResolvedValueOnce({
      id: "created-page-2",
      createdTime: "2024-09-01T10:00:00.000Z",
      lastEditedTime: "2024-09-01T10:00:00.000Z",
      fields: { title: "x" },
    });

    const tools = await getTools();
    const result = await tools.report_issue.execute({
      title: "Resin leak",
      description: "Leaking resin",
      unit_label: "Form 4 // A",
      priority: "High",
    });

    expect(result.success).toBe(true);
    expect(result.unit_resolved).toEqual({
      id: "unit-form-4-a",
      label: "Form 4 // A",
    });
    expect(createMaintenanceLog).toHaveBeenCalledWith(
      expect.objectContaining({ unit: ["unit-form-4-a"] })
    );
  });

  it("returns { success:false, error } when createMaintenanceLog rejects", async () => {
    createMaintenanceLog.mockRejectedValueOnce(new Error("Notion is down"));

    const tools = await getTools();
    const result = await tools.report_issue.execute({
      title: "Broken",
      description: "It is broken",
      priority: "Low",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Notion is down");
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
    fetchAllResources.mockResolvedValueOnce([
      resource({ id: "r1", title: "Manual 1", url: "https://x.test/m1.pdf" }),
      resource({ id: "r2", title: "Manual 2", url: "https://x.test/m2.pdf" }),
      resource({ id: "r3", title: "Manual 3", url: "https://x.test/m3.pdf" }),
      resource({ id: "r4", title: "Manual 4", url: "https://x.test/m4.pdf" }),
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
    fetchAllResources.mockResolvedValueOnce([
      resource({ id: "r1", title: "Good", url: "https://x.test/good.pdf" }),
      resource({ id: "r2", title: "Huge", url: "https://x.test/huge.pdf" }),
      resource({ id: "r3", title: "Dead", url: "https://x.test/dead.pdf" }),
      // Non-PDF url → skipped entirely (never fetched).
      resource({ id: "r4", title: "Webpage", url: "https://x.test/page.html" }),
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
    fetchAllResources.mockResolvedValueOnce([
      resource({
        id: "r1",
        title: "Unpublished",
        url: "https://x.test/u.pdf",
        published: false,
      }),
      resource({
        id: "r2",
        title: "OtherTool",
        url: "https://x.test/o.pdf",
        tool: ["tool-trotec-speedy-400"],
      }),
    ]);
    const fetchMock = vi.fn(async () => okPdf(PDF_SMALL));
    vi.stubGlobal("fetch", fetchMock);

    await POST(
      chatRequest({ messages: [userMessage("help")], toolId: "form-4" })
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(captured.args.system).not.toContain("Available manuals");
  });

  it("does not run manual collection when no toolId is provided", async () => {
    fetchAllResources.mockResolvedValueOnce([
      resource({ id: "r1", title: "Manual 1", url: "https://x.test/m1.pdf" }),
    ]);
    const fetchMock = vi.fn(async () => okPdf(PDF_SMALL));
    vi.stubGlobal("fetch", fetchMock);

    await POST(chatRequest({ messages: [userMessage("hi")] }));

    expect(fetchAllResources).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
