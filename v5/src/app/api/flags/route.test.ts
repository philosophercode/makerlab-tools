import { http, HttpResponse } from "msw";
import { server } from "../../../../test/msw/server";
import { DB_IDS } from "../../../../test/msw/handlers";
import { nextCacheMock } from "../../../../test/mocks/next-cache";

// The route reaches the catalog (for tool resolution) which imports next/cache.
vi.mock("next/cache", () => nextCacheMock());

import { POST } from "./route";

const NOTION = "https://api.notion.com/v1";
const FORM_4_ID = "tool-form-4";

// The in-memory limiter is a per-process singleton keyed by IP, so each test
// gets its own IP to avoid bleeding a spent window into the next one.
let ipCounter = 0;
function uniqueIp() {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
}

function stubFlagsEnv() {
  vi.stubEnv("NOTION_API_KEY", "secret_test");
  vi.stubEnv("NOTION_DB_FLAGS", DB_IDS.flags);
}

function flagRequest(body: unknown, ip = uniqueIp()) {
  return new Request("http://localhost/api/flags", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as never;
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    tool_id: FORM_4_ID,
    field_flagged: "location",
    issue_description: "This lives in the Resin Bench, not the Wood Shop.",
    ...overrides,
  };
}

/** Record every Notion write the route provokes, per database. */
function captureNotionWrites() {
  const creates: Array<{ parent: { database_id: string }; properties: Record<string, unknown> }> =
    [];
  const patches: string[] = [];
  server.use(
    http.post(`${NOTION}/pages`, async ({ request }) => {
      const body = (await request.json()) as (typeof creates)[number];
      creates.push(body);
      return HttpResponse.json({
        object: "page",
        id: "flag-page-1",
        created_time: "2026-07-29T10:00:00.000Z",
        last_edited_time: "2026-07-29T10:00:00.000Z",
        properties: body.properties,
      });
    }),
    http.patch(`${NOTION}/pages/:id`, ({ params }) => {
      patches.push(params.id as string);
      return HttpResponse.json({ object: "page", id: params.id });
    })
  );
  return { creates, patches };
}

describe("POST /api/flags", () => {
  it("creates a Flags row with status New and returns 201", async () => {
    stubFlagsEnv();
    const { creates } = captureNotionWrites();

    const res = await POST(flagRequest(validPayload({ reporter: "Ada" })));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "flag-page-1" });
    expect(creates).toHaveLength(1);
    expect(creates[0].properties).toMatchObject({
      status: { select: { name: "New" } },
      field_flagged: { select: { name: "location" } },
    });
  });

  // The assertion that matters (spec §10): a flag is inert.
  it("never writes to the Tools database", async () => {
    stubFlagsEnv();
    const { creates, patches } = captureNotionWrites();

    await POST(flagRequest(validPayload()));

    expect(creates).toHaveLength(1);
    expect(creates[0].parent.database_id).toBe(DB_IDS.flags);
    expect(
      creates.some((create) => create.parent.database_id === DB_IDS.tools)
    ).toBe(false);
    // Nor does it edit the tool page it refers to.
    expect(patches).toEqual([]);
  });

  it("rejects an invalid field_flagged with 400 and writes nothing", async () => {
    stubFlagsEnv();
    const { creates } = captureNotionWrites();

    const res = await POST(flagRequest(validPayload({ field_flagged: "price" })));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: "invalid_input" });
    expect(creates).toHaveLength(0);
  });

  it("rejects an empty description with 400", async () => {
    stubFlagsEnv();
    const res = await POST(flagRequest(validPayload({ issue_description: "   " })));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: "invalid_input" });
  });

  it("rejects a body that is not JSON with 400", async () => {
    stubFlagsEnv();
    const res = await POST(flagRequest("not json at all"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: "invalid_input" });
  });

  it("returns 404 for a tool that is not in the catalog", async () => {
    stubFlagsEnv();
    const res = await POST(flagRequest(validPayload({ tool_id: "tool-nope" })));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: "unknown_tool" });
  });

  it("returns 503 when the Flags database is not configured", async () => {
    vi.stubEnv("NOTION_API_KEY", "");
    vi.stubEnv("NOTION_DB_FLAGS", "");
    const res = await POST(flagRequest(validPayload()));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ code: "not_configured" });
  });

  it("returns 429 after the fifth report from one IP", async () => {
    stubFlagsEnv();
    captureNotionWrites();
    const ip = uniqueIp();

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const ok = await POST(flagRequest(validPayload(), ip));
      expect(ok.status, `attempt ${attempt}`).toBe(201);
    }

    const limited = await POST(flagRequest(validPayload(), ip));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("3600");
    expect(await limited.json()).toEqual({ code: "rate_limited" });
  });

  it("returns 502 on a Notion failure without leaking the Notion error", async () => {
    stubFlagsEnv();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    server.use(
      http.post(`${NOTION}/pages`, () =>
        HttpResponse.json(
          {
            object: "error",
            code: "validation_error",
            message: "property 'field_flagged' does not exist",
          },
          { status: 400 }
        )
      )
    );

    const res = await POST(flagRequest(validPayload()));

    expect(res.status).toBe(502);
    const body = await res.text();
    expect(body).toBe(JSON.stringify({ code: "write_failed" }));
    expect(body).not.toMatch(/validation_error|does not exist|property/i);
    // The detail is still visible to operators in the server log (Art. 4).
    expect(logged).toHaveBeenCalled();
  });
});
