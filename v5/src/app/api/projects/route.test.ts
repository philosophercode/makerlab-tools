import { http, HttpResponse } from "msw";

import { server } from "../../../../test/msw/server";

const NOTION = "https://api.notion.com/v1";
const PROJECTS_DB = "db-projects";

// ── Helpers ─────────────────────────────────────────────────────────

// The in-memory limiter is a per-process singleton keyed by `projects:<ip>` —
// every test gets its own IP so one test's requests can't exhaust another's
// window.
let ipCounter = 0;
function uniqueIp() {
  ipCounter += 1;
  return `10.1.0.${ipCounter}`;
}

function stubProjectsEnv() {
  vi.stubEnv("NOTION_API_KEY", "secret_test");
  vi.stubEnv("NOTION_DB_PROJECTS", PROJECTS_DB);
}

interface SubmitOptions {
  ip?: string;
  raw?: string;
}

// The route only uses `getClientIp(req)` (headers) and `req.json()`, so a plain
// Request is enough; it's cast at the call site because the signature asks for
// a NextRequest.
function submitRequest(payload: unknown, { ip, raw }: SubmitOptions = {}) {
  return new Request("http://localhost/api/projects", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip ?? uniqueIp(),
    },
    body: raw ?? JSON.stringify(payload),
  });
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    title: "Lamp from scrap plywood",
    author: "Ada Lovelace",
    body: "Cut on the laser, glued, sanded.",
    tools: ["tool-form-4"],
    materials: ["Plywood"],
    photos: [{ id: "file-upload-1", name: "cover.png" }],
    ...overrides,
  };
}

type NotionCreateBody = {
  parent?: { database_id?: string };
  properties?: Record<string, { checkbox?: boolean; files?: unknown[] }>;
};

/**
 * Capture the body of the Notion page-create call. Returns a getter that is
 * `undefined` when the route never reached Notion — which is itself the
 * assertion for every rejected payload.
 */
function captureNotionCreate() {
  const calls: NotionCreateBody[] = [];
  server.use(
    http.post(`${NOTION}/pages`, async ({ request }) => {
      const body = (await request.json()) as NotionCreateBody;
      calls.push(body);
      return HttpResponse.json({
        object: "page",
        id: "created-project-1",
        created_time: "2024-09-01T10:00:00.000Z",
        last_edited_time: "2024-09-01T10:00:00.000Z",
        properties: body.properties ?? {},
      });
    })
  );
  return calls;
}

async function loadRoute() {
  return import("./route");
}

async function post(req: Request) {
  const { POST } = await loadRoute();
  return POST(req as never);
}

// ── Configuration ───────────────────────────────────────────────────

describe("POST /api/projects (not configured)", () => {
  it("returns 503 with a clear message and never calls Notion", async () => {
    vi.stubEnv("NOTION_API_KEY", "");
    vi.stubEnv("NOTION_DB_PROJECTS", "");

    const res = await post(submitRequest(validPayload()));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/not configured/i);
  });
});

// ── The moderation gate (Article 5) ─────────────────────────────────

describe("POST /api/projects (drafts by default)", () => {
  it("creates the page with published explicitly false", async () => {
    stubProjectsEnv();
    const calls = captureNotionCreate();

    const res = await post(submitRequest(validPayload()));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "created-project-1" });
    expect(calls).toHaveLength(1);
    expect(calls[0].parent?.database_id).toBe(PROJECTS_DB);
    expect(calls[0].properties?.published).toEqual({ checkbox: false });
  });

  it("IGNORES published:true from the client — the submission stays a draft", async () => {
    stubProjectsEnv();
    const calls = captureNotionCreate();

    const res = await post(
      submitRequest(
        validPayload({ published: true, Published: true, fields: { published: true } })
      )
    );

    expect(res.status).toBe(201);
    // The single most important assertion in this feature: nothing a client
    // sends may publish a project. Staff tick the box in Notion, or it stays
    // invisible.
    expect(calls[0].properties?.published).toEqual({ checkbox: false });
    expect(JSON.stringify(calls[0])).not.toContain('"checkbox":true');
  });

  it("writes the submitted fields through to Notion", async () => {
    stubProjectsEnv();
    const calls = captureNotionCreate();

    await post(
      submitRequest(
        validPayload({ link: "https://example.com/lamp", tools: ["tool-form-4", "tool-2"] })
      )
    );

    const properties = calls[0].properties as Record<string, unknown>;
    expect(properties.title).toEqual({
      title: [{ text: { content: "Lamp from scrap plywood" } }],
    });
    expect(properties.author).toEqual({
      rich_text: [{ text: { content: "Ada Lovelace" } }],
    });
    expect(properties.link).toEqual({ url: "https://example.com/lamp" });
    expect(properties.tools_used).toEqual({
      relation: [{ id: "tool-form-4" }, { id: "tool-2" }],
    });
    expect(properties.materials).toEqual({ multi_select: [{ name: "Plywood" }] });
    // Photos go in as file_upload references from /api/upload-notion.
    expect(properties.photos).toEqual({
      files: [
        {
          type: "file_upload",
          file_upload: { id: "file-upload-1" },
          name: "cover.png",
        },
      ],
    });
  });
});

// ── Validation ──────────────────────────────────────────────────────

describe("POST /api/projects (validation)", () => {
  it("rejects malformed JSON with 400", async () => {
    stubProjectsEnv();
    captureNotionCreate();

    const res = await post(submitRequest(null, { raw: "{not json" }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid json/i);
  });

  it.each([
    ["title", { title: "" }],
    ["author", { author: "   " }],
    ["body", { body: "" }],
  ])("rejects a submission missing %s with 400", async (_field, overrides) => {
    stubProjectsEnv();
    const calls = captureNotionCreate();

    const res = await post(submitRequest(validPayload(overrides)));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/required/i);
    expect(calls).toHaveLength(0);
  });

  it("rejects an oversized write-up with 400", async () => {
    stubProjectsEnv();
    const calls = captureNotionCreate();

    const res = await post(
      submitRequest(validPayload({ body: "x".repeat(20_001) }))
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/too long/i);
    expect(calls).toHaveLength(0);
  });

  it("accepts a write-up right at the size limit", async () => {
    stubProjectsEnv();
    const calls = captureNotionCreate();

    const res = await post(
      submitRequest(validPayload({ body: "x".repeat(20_000) }))
    );

    expect(res.status).toBe(201);
    expect(calls).toHaveLength(1);
  });

  it("rejects more than 8 photos with 400 rather than silently dropping them", async () => {
    stubProjectsEnv();
    const calls = captureNotionCreate();
    const photos = Array.from({ length: 9 }, (_, i) => ({
      id: `file-upload-${i}`,
      name: `photo-${i}.png`,
    }));

    const res = await post(submitRequest(validPayload({ photos })));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/8 photos/i);
    expect(calls).toHaveLength(0);
  });

  it("accepts exactly 8 photos", async () => {
    stubProjectsEnv();
    const calls = captureNotionCreate();
    const photos = Array.from({ length: 8 }, (_, i) => ({
      id: `file-upload-${i}`,
      name: `photo-${i}.png`,
    }));

    const res = await post(submitRequest(validPayload({ photos })));

    expect(res.status).toBe(201);
    expect(calls[0].properties?.photos).toHaveProperty("files");
    expect((calls[0].properties?.photos as { files: unknown[] }).files).toHaveLength(8);
  });

  it("rejects more than 20 tools with 400", async () => {
    stubProjectsEnv();
    const calls = captureNotionCreate();
    const tools = Array.from({ length: 21 }, (_, i) => `tool-${i}`);

    const res = await post(submitRequest(validPayload({ tools })));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/20 tools/i);
    expect(calls).toHaveLength(0);
  });

  it("accepts exactly 20 tools", async () => {
    stubProjectsEnv();
    const calls = captureNotionCreate();
    const tools = Array.from({ length: 20 }, (_, i) => `tool-${i}`);

    const res = await post(submitRequest(validPayload({ tools })));

    expect(res.status).toBe(201);
    expect(
      (calls[0].properties?.tools_used as { relation: unknown[] }).relation
    ).toHaveLength(20);
  });

  it("ignores non-string entries in tools and materials", async () => {
    stubProjectsEnv();
    const calls = captureNotionCreate();

    const res = await post(
      submitRequest(
        validPayload({ tools: ["tool-form-4", 7, null], materials: [{}, "Plywood"] })
      )
    );

    expect(res.status).toBe(201);
    expect(calls[0].properties?.tools_used).toEqual({
      relation: [{ id: "tool-form-4" }],
    });
    expect(calls[0].properties?.materials).toEqual({
      multi_select: [{ name: "Plywood" }],
    });
  });
});

// ── Link scheme validation ──────────────────────────────────────────

describe("POST /api/projects (link validation)", () => {
  it.each([
    "javascript:alert(document.cookie)",
    "JavaScript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "file:///etc/passwd",
    "not a url at all",
  ])("rejects %s with 400 and never reaches Notion", async (link) => {
    stubProjectsEnv();
    const calls = captureNotionCreate();

    const res = await post(submitRequest(validPayload({ link })));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/http/i);
    expect(calls).toHaveLength(0);
  });

  it.each(["https://example.com/lamp", "http://example.com/lamp"])(
    "accepts %s",
    async (link) => {
      stubProjectsEnv();
      const calls = captureNotionCreate();

      const res = await post(submitRequest(validPayload({ link })));

      expect(res.status).toBe(201);
      expect(calls[0].properties?.link).toEqual({ url: link });
    }
  );
});

// ── Rate limiting ───────────────────────────────────────────────────

describe("POST /api/projects (rate limiting)", () => {
  it("returns 429 with Retry-After once the limiter says no", async () => {
    stubProjectsEnv();
    const calls = captureNotionCreate();
    vi.resetModules();
    vi.doMock("@/lib/rate-limit", async () => {
      const actual = await vi.importActual<typeof import("@/lib/rate-limit")>(
        "@/lib/rate-limit"
      );
      return {
        ...actual,
        rateLimitAsync: vi.fn(async () => ({ allowed: false, remaining: 0 })),
      };
    });
    const { POST } = await import("./route");

    const res = await POST(submitRequest(validPayload()) as never);

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect((await res.json()).error).toMatch(/too many requests/i);
    // Rate limiting happens before the expensive outbound call (Article 4).
    expect(calls).toHaveLength(0);

    vi.doUnmock("@/lib/rate-limit");
    vi.resetModules();
  });

  it("starts refusing the same IP once its window is exhausted", async () => {
    stubProjectsEnv();
    captureNotionCreate();
    const ip = uniqueIp();

    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const res = await post(submitRequest(validPayload(), { ip }));
      statuses.push(res.status);
    }

    expect(statuses[0]).toBe(201);
    expect(statuses).toContain(429);
    // Once refused, it stays refused for the rest of the window.
    expect(statuses.at(-1)).toBe(429);
  });

  it("does not penalize a different IP", async () => {
    stubProjectsEnv();
    captureNotionCreate();
    const noisy = uniqueIp();
    for (let i = 0; i < 12; i += 1) {
      await post(submitRequest(validPayload(), { ip: noisy }));
    }

    const res = await post(submitRequest(validPayload(), { ip: uniqueIp() }));
    expect(res.status).toBe(201);
  });
});

// ── Notion failure ──────────────────────────────────────────────────

describe("POST /api/projects (Notion failure)", () => {
  it("returns 502 and does not leak the raw Notion error", async () => {
    stubProjectsEnv();
    const notionMessage =
      "validation_error: body.properties.tools_used[0].id is not a valid uuid (db-projects, token secret_test)";
    server.use(
      http.post(`${NOTION}/pages`, () =>
        HttpResponse.json(
          { object: "error", status: 400, code: "validation_error", message: notionMessage },
          { status: 400 }
        )
      )
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await post(submitRequest(validPayload()));

    expect(res.status).toBe(502);
    const raw = await res.text();
    expect(raw).not.toContain(notionMessage);
    expect(raw).not.toContain("validation_error");
    expect(raw).not.toContain("secret_test");
    expect(JSON.parse(raw).error).toMatch(/try again/i);
    // The detail is still logged server-side.
    expect(error).toHaveBeenCalled();
  });
});
