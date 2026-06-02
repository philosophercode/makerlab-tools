/**
 * Integration tests for the MCP API route (`src/app/api/mcp/route.ts`).
 *
 * Strategy (per design doc §2 #6 + §4 "Layer B · /api/mcp"):
 * - Use the REAL `McpServer` the route constructs. We don't mock it.
 * - POST real JSON-RPC envelopes (`initialize`, `tools/list`, `tools/call`) to
 *   the route's `POST` handler and assert the JSON responses.
 * - `enableJsonResponse: true` in the route means the transport returns a single
 *   JSON object (not an SSE stream), so `await res.json()` works directly.
 * - Catalog comes from the mock-catalog fallback (no NOTION_* env set), so tool
 *   results are deterministic and offline.
 * - `@/lib/notion`'s `fetchMaintenanceLogsByUnit` is mocked so the maintenance
 *   tools are deterministic without any network.
 *
 * SDK quirk discovered: the WebStandardStreamableHTTPServerTransport is created
 * with `sessionIdGenerator: undefined` (stateless mode). In that mode the
 * transport SKIPS session validation (`validateSession` returns early), so
 * `tools/list` / `tools/call` can be POSTed WITHOUT a prior `initialize`
 * handshake and WITHOUT an `mcp-session-id` header. The only hard requirement is
 * the `Accept` header must include BOTH `application/json` and
 * `text/event-stream`, otherwise the transport returns a 406. We therefore send
 * `accept: "application/json, text/event-stream"` on every request and drive
 * each method statelessly.
 */

import { POST, GET } from "@/app/api/mcp/route";

// Partial-mock @/lib/notion: override ONLY `fetchMaintenanceLogsByUnit` and keep
// every other export real. (catalog.ts also imports from this module — e.g.
// getNotionEnvContract, fetchAllTools — so a full replacement would break the
// catalog's mock-fallback path.) The catalog itself still comes from the
// mock-catalog because NOTION_* env stays unset.
vi.mock("@/lib/notion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notion")>();
  return {
    ...actual,
    fetchMaintenanceLogsByUnit: vi.fn(async () => []),
  };
});

import { fetchMaintenanceLogsByUnit } from "@/lib/notion";

const fetchLogsMock = vi.mocked(fetchMaintenanceLogsByUnit);

const MCP_URL = "http://localhost/api/mcp";

/** Build a JSON-RPC POST Request with the Accept header the transport requires. */
function rpcRequest(
  body: unknown,
  extraHeaders: Record<string, string> = {}
): Request {
  return new Request(MCP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

let nextId = 1;
function envelope(method: string, params?: Record<string, unknown>) {
  return { jsonrpc: "2.0", id: nextId++, method, ...(params ? { params } : {}) };
}

/** POST a JSON-RPC method and return the parsed JSON-RPC response object. */
async function callRpc(
  method: string,
  params?: Record<string, unknown>,
  extraHeaders: Record<string, string> = {}
) {
  const res = await POST(rpcRequest(envelope(method, params), extraHeaders));
  const json = await res.json();
  return { res, json };
}

/** Extract the joined text content of a tools/call result. */
function resultText(json: { result?: { content?: Array<{ type: string; text?: string }> } }) {
  return (json.result?.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
}

async function callTool(name: string, args: Record<string, unknown> = {}) {
  return callRpc("tools/call", { name, arguments: args });
}

beforeEach(() => {
  fetchLogsMock.mockReset();
  fetchLogsMock.mockResolvedValue([]);
});

// ── GET handler ──────────────────────────────────────────────────────

describe("GET /api/mcp", () => {
  it("returns 405 with a JSON-RPC error", async () => {
    const res = await GET(
      new Request(MCP_URL, {
        method: "GET",
        headers: { accept: "application/json, text/event-stream" },
      })
    );
    expect(res.status).toBe(405);
    const json = await res.json();
    expect(json.jsonrpc).toBe("2.0");
    expect(json.error.code).toBe(-32000);
    expect(json.error.message).toMatch(/SSE not supported/i);
  });
});

// ── Auth ─────────────────────────────────────────────────────────────

describe("auth (MCP_TOKEN)", () => {
  it("is open (no 401) when MCP_TOKEN is unset", async () => {
    // NOTION_* and MCP_TOKEN both unset by default.
    const { res, json } = await callRpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0.0" },
    });
    expect(res.status).toBe(200);
    expect(json.result).toBeDefined();
  });

  it("returns 401 JSON-RPC error when MCP_TOKEN is set and Authorization is missing", async () => {
    vi.stubEnv("MCP_TOKEN", "secret-mcp");
    const res = await POST(rpcRequest(envelope("tools/list")));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.jsonrpc).toBe("2.0");
    expect(json.error.code).toBe(-32001);
    expect(json.error.message).toMatch(/unauthorized/i);
    expect(json.id).toBeNull();
  });

  it("returns 401 when MCP_TOKEN is set and the bearer token is wrong", async () => {
    vi.stubEnv("MCP_TOKEN", "secret-mcp");
    const res = await POST(
      rpcRequest(envelope("tools/list"), { authorization: "Bearer wrong-token" })
    );
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error.code).toBe(-32001);
  });

  it("proceeds when MCP_TOKEN is set and a correct Bearer token is supplied", async () => {
    vi.stubEnv("MCP_TOKEN", "secret-mcp");
    const { res, json } = await callRpc(
      "tools/list",
      undefined,
      { authorization: "Bearer secret-mcp" }
    );
    expect(res.status).toBe(200);
    expect(json.result?.tools).toBeDefined();
  });
});

// ── Rate limit ───────────────────────────────────────────────────────

describe("rate limiting", () => {
  it("returns 429 JSON-RPC error when rateLimitAsync denies the request", async () => {
    // Mock the rate limiter only for this test, then re-import the route so it
    // binds to the mocked module.
    vi.resetModules();
    vi.doMock("@/lib/rate-limit", () => ({
      getClientIp: vi.fn(() => "1.2.3.4"),
      rateLimitAsync: vi.fn(async () => ({ allowed: false })),
    }));
    const route = await import("@/app/api/mcp/route");
    const res = await route.POST(rpcRequest(envelope("tools/list")));
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.jsonrpc).toBe("2.0");
    expect(json.error.code).toBe(-32000);
    expect(json.error.message).toMatch(/too many requests/i);
    expect(json.id).toBeNull();
    vi.doUnmock("@/lib/rate-limit");
    vi.resetModules();
  });
});

// ── JSON-RPC protocol ────────────────────────────────────────────────

describe("JSON-RPC protocol", () => {
  it("initialize returns protocolVersion, capabilities, and serverInfo (makerlab)", async () => {
    const { res, json } = await callRpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0.0" },
    });
    expect(res.status).toBe(200);
    expect(json.result.protocolVersion).toBeDefined();
    expect(json.result.capabilities).toBeDefined();
    expect(json.result.serverInfo.name).toBe("makerlab");
    expect(json.result.serverInfo.version).toBe("1.0.0");
  });

  it("tools/list lists exactly the 5 registered tools", async () => {
    const { json } = await callRpc("tools/list");
    const names = (json.result.tools as Array<{ name: string }>)
      .map((t) => t.name)
      .sort();
    expect(names).toEqual(
      [
        "get_maintenance_history",
        "get_tool_details",
        "get_unit_details",
        "list_tools",
        "search_tools",
      ].sort()
    );
  });
});

// ── tools/call: list_tools ───────────────────────────────────────────

describe("tools/call: list_tools", () => {
  // The MCP adapter serializes each tool's structured result as pretty-printed
  // JSON (design spec §3.3), so we parse and assert on the data shape.
  it("returns a structured summary of the whole catalog", async () => {
    const { json } = await callTool("list_tools");
    const parsed = JSON.parse(resultText(json));
    // mock-catalog has 2 tools (Form 4, Trotec Speedy 400).
    expect(parsed.count).toBe(2);
    const names = parsed.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("Form 4");
    expect(names).toContain("Trotec Speedy 400");
  });

  it("narrows results with a category filter", async () => {
    const { json } = await callTool("list_tools", { category: "laser" });
    const parsed = JSON.parse(resultText(json));
    expect(parsed.count).toBe(1);
    const names = parsed.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(["Trotec Speedy 400"]);
  });

  it("narrows results with a location filter", async () => {
    const { json } = await callTool("list_tools", { location: "Resin" });
    const parsed = JSON.parse(resultText(json));
    expect(parsed.count).toBe(1);
    const names = parsed.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(["Form 4"]);
  });
});

// ── tools/call: search_tools ─────────────────────────────────────────

describe("tools/call: search_tools", () => {
  it("returns matching tools on a hit", async () => {
    const { json } = await callTool("search_tools", { query: "resin" });
    const parsed = JSON.parse(resultText(json));
    expect(parsed.count).toBe(1);
    expect(parsed.tools.map((t: { name: string }) => t.name)).toContain("Form 4");
  });

  it("returns an empty result set on a miss", async () => {
    const { json } = await callTool("search_tools", { query: "nonexistent-widget-xyz" });
    const parsed = JSON.parse(resultText(json));
    expect(parsed.query).toBe("nonexistent-widget-xyz");
    expect(parsed.count).toBe(0);
    expect(parsed.tools).toEqual([]);
  });
});

// ── tools/call: get_tool_details ─────────────────────────────────────

describe("tools/call: get_tool_details", () => {
  it("returns JSON with tool fields + detail_page when found", async () => {
    const { json } = await callTool("get_tool_details", { id_or_name: "form-4" });
    const text = resultText(json);
    const parsed = JSON.parse(text);
    expect(parsed.slug).toBe("form-4");
    expect(parsed.name).toBe("Form 4");
    expect(parsed.category).toBe("3D Printing");
    expect(parsed.detail_page).toBe("/tools/form-4");
    expect(json.result.isError).toBeFalsy();
  });

  it("resolves a tool by (partial) name", async () => {
    const { json } = await callTool("get_tool_details", { id_or_name: "Trotec" });
    const text = resultText(json);
    const parsed = JSON.parse(text);
    expect(parsed.slug).toBe("trotec-speedy-400");
    expect(parsed.name).toBe("Trotec Speedy 400");
  });

  it("returns a structured not-found result for an unknown id", async () => {
    const { json } = await callTool("get_tool_details", { id_or_name: "no-such-tool-id" });
    // Not-found is a normal structured result (found:false), not a tool error.
    expect(json.result.isError).toBeFalsy();
    const parsed = JSON.parse(resultText(json));
    expect(parsed.found).toBe(false);
    expect(parsed.message).toMatch(/Tool not found: no-such-tool-id/);
  });
});

// ── tools/call: get_unit_details ─────────────────────────────────────

describe("tools/call: get_unit_details", () => {
  it("returns JSON for a real mock unit label", async () => {
    const { json } = await callTool("get_unit_details", { unit_label: "Form 4 // A" });
    const text = resultText(json);
    const parsed = JSON.parse(text);
    expect(parsed.unit_label).toBe("Form 4 // A");
    expect(parsed.tool_name).toBe("Form 4");
    expect(parsed.tool_slug).toBe("form-4");
    expect(parsed.detail_page).toBe("/tools/form-4");
    expect(parsed.maintenance_logs).toEqual([]);
  });

  it("returns a structured not-found result for an unknown label", async () => {
    const { json } = await callTool("get_unit_details", { unit_label: "no-such-unit-999" });
    const parsed = JSON.parse(resultText(json));
    expect(parsed.found).toBe(false);
    expect(parsed.message).toMatch(/No unit found matching "no-such-unit-999"/);
  });
});

// ── tools/call: get_maintenance_history ──────────────────────────────

describe("tools/call: get_maintenance_history", () => {
  it("returns a JSON list of logs when the unit has maintenance history", async () => {
    fetchLogsMock.mockResolvedValue([
      {
        id: "log-1",
        createdTime: "2024-09-01T10:00:00.000Z",
        lastEditedTime: "2024-09-01T10:00:00.000Z",
        fields: {
          title: "Resin tank cloudy",
          type: "Repair",
          priority: "High",
          status: "Open",
          date_reported: "2024-09-01",
          description: "The resin tank film is clouded and needs replacement.",
        },
      },
    ] as Awaited<ReturnType<typeof fetchMaintenanceLogsByUnit>>);

    const { json } = await callTool("get_maintenance_history", {
      unit_label: "Form 4 // A",
    });
    const text = resultText(json);
    const parsed = JSON.parse(text);
    expect(parsed.unit_label).toBe("Form 4 // A");
    expect(parsed.maintenance_logs).toHaveLength(1);
    expect(parsed.maintenance_logs[0].title).toBe("Resin tank cloudy");
    expect(parsed.maintenance_logs[0].priority).toBe("High");
    // Confirm the fetch was driven with the matched unit's id.
    expect(fetchLogsMock).toHaveBeenCalledWith("unit-form-4-a");
  });

  it("returns an empty log list when the unit has no logs", async () => {
    fetchLogsMock.mockResolvedValue([]);
    const { json } = await callTool("get_maintenance_history", {
      unit_label: "Form 4 // A",
    });
    const parsed = JSON.parse(resultText(json));
    expect(parsed.found).toBe(true);
    expect(parsed.unit_label).toBe("Form 4 // A");
    expect(parsed.maintenance_logs).toEqual([]);
  });

  it("returns a structured not-found result for an unknown unit label", async () => {
    const { json } = await callTool("get_maintenance_history", {
      unit_label: "no-such-unit-999",
    });
    expect(json.result.isError).toBeFalsy();
    const parsed = JSON.parse(resultText(json));
    expect(parsed.found).toBe(false);
    expect(parsed.message).toMatch(/No unit found matching "no-such-unit-999"/);
  });
});
