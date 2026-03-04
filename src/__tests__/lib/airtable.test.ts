import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Must mock "server-only" before any import that pulls it in
vi.mock("server-only", () => ({}));

// Mock unpdf to avoid loading native code in tests
vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(),
  extractText: vi.fn(),
}));

// ── Fixture factories ──────────────────────────────────────────────

function makeTool(overrides: Record<string, unknown> = {}) {
  return {
    id: "recTEST123",
    createdTime: "2025-01-01T00:00:00.000Z",
    fields: {
      name: "Test Tool",
      description: "A test tool",
      category: ["recCAT1"],
      location: ["recLOC1"],
      materials: ["Wood"],
      ppe_required: ["Safety Glasses"],
      tags: ["cutting"],
      training_required: true,
      authorized_only: false,
      ...overrides,
    },
  };
}

function makeCategory(
  id: string,
  fields: { name: string; group: string }
) {
  return { id, createdTime: "2025-01-01T00:00:00.000Z", fields };
}

function makeLocation(
  id: string,
  fields: { name: string; room: string }
) {
  return { id, createdTime: "2025-01-01T00:00:00.000Z", fields };
}

function makeUnit(
  id: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    id,
    createdTime: "2025-01-01T00:00:00.000Z",
    fields: {
      unit_label: "Unit A",
      tool: ["recTOOL1"],
      status: "Available",
      condition: "Good",
      ...overrides,
    },
  };
}

// ── Helpers ────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

// ── Type for the airtable module ───────────────────────────────────

type AirtableModule = typeof import("@/lib/airtable");

// ── Test suite ─────────────────────────────────────────────────────

describe("airtable", () => {
  const originalFetch = globalThis.fetch;

  // Dynamic import variables — re-imported per test so module-level
  // constants (BASE_ID, API_KEY) pick up the stubbed env vars.
  let fetchAllTools: AirtableModule["fetchAllTools"];
  let fetchTool: AirtableModule["fetchTool"];
  let fetchUnitsByTool: AirtableModule["fetchUnitsByTool"];
  let resolveTools: AirtableModule["resolveTools"];
  let createMaintenanceLog: AirtableModule["createMaintenanceLog"];

  beforeEach(async () => {
    vi.resetModules();

    // Re-apply mocks after module reset
    vi.mock("server-only", () => ({}));
    vi.mock("unpdf", () => ({
      getDocumentProxy: vi.fn(),
      extractText: vi.fn(),
    }));

    // Stub env vars BEFORE importing the module so the module-level
    // `const BASE_ID = process.env.AIRTABLE_BASE_ID!` captures them.
    vi.stubEnv("AIRTABLE_API_KEY", "fake-api-key");
    vi.stubEnv("AIRTABLE_BASE_ID", "appTEST123");

    globalThis.fetch = vi.fn();

    const mod = await import("@/lib/airtable");
    fetchAllTools = mod.fetchAllTools;
    fetchTool = mod.fetchTool;
    fetchUnitsByTool = mod.fetchUnitsByTool;
    resolveTools = mod.resolveTools;
    createMaintenanceLog = mod.createMaintenanceLog;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── fetchAllTools ──────────────────────────────────────────────

  describe("fetchAllTools", () => {
    it("returns an array of tool records", async () => {
      const tools = [makeTool(), makeTool({ name: "Drill Press" })];

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        jsonResponse({ records: tools })
      );

      const result = await fetchAllTools();

      expect(result).toHaveLength(2);
      expect(result[0].fields.name).toBe("Test Tool");
      expect(result[1].fields.name).toBe("Drill Press");
    });

    it("handles pagination via offset", async () => {
      const page1 = [makeTool({ name: "Tool A" })];
      const page2 = [makeTool({ name: "Tool B" })];

      vi.mocked(globalThis.fetch)
        .mockResolvedValueOnce(
          jsonResponse({ records: page1, offset: "page2token" })
        )
        .mockResolvedValueOnce(
          jsonResponse({ records: page2 })
        );

      const result = await fetchAllTools();

      expect(result).toHaveLength(2);
      expect(result[0].fields.name).toBe("Tool A");
      expect(result[1].fields.name).toBe("Tool B");
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);

      // Second call should include the offset parameter
      const secondCallUrl = vi.mocked(globalThis.fetch).mock.calls[1][0] as string;
      expect(secondCallUrl).toContain("offset=page2token");
    });

    it("includes sort parameters in the request", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        jsonResponse({ records: [] })
      );

      await fetchAllTools();

      const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(calledUrl).toContain("sort%5B0%5D%5Bfield%5D=name");
      expect(calledUrl).toContain("sort%5B0%5D%5Bdirection%5D=asc");
    });

    it("passes the Authorization header with the API key", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        jsonResponse({ records: [] })
      );

      await fetchAllTools();

      const calledOptions = vi.mocked(globalThis.fetch).mock.calls[0][1] as RequestInit;
      expect((calledOptions.headers as Record<string, string>)["Authorization"]).toBe(
        "Bearer fake-api-key"
      );
    });

    it("builds the URL with the correct base ID", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        jsonResponse({ records: [] })
      );

      await fetchAllTools();

      const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(calledUrl).toContain("https://api.airtable.com/v0/appTEST123/");
    });
  });

  // ── fetchTool ──────────────────────────────────────────────────

  describe("fetchTool", () => {
    it("returns a single tool record", async () => {
      const tool = makeTool();
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(jsonResponse(tool));

      const result = await fetchTool("recTEST123");

      expect(result.id).toBe("recTEST123");
      expect(result.fields.name).toBe("Test Tool");
    });

    it("throws on not found (404)", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response("NOT_FOUND", { status: 404 })
      );

      await expect(fetchTool("recNONEXISTENT")).rejects.toThrow(
        "AirTable API 404"
      );
    });

    it("throws on server error (500)", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response("Internal Server Error", { status: 500 })
      );

      await expect(fetchTool("recTEST123")).rejects.toThrow(
        "AirTable API 500"
      );
    });
  });

  // ── fetchUnitsByTool ───────────────────────────────────────────

  describe("fetchUnitsByTool", () => {
    it("returns only units that belong to the given tool", async () => {
      const units = [
        makeUnit("recU1", { tool: ["recTOOL1"] }),
        makeUnit("recU2", { tool: ["recTOOL2"] }),
        makeUnit("recU3", { tool: ["recTOOL1"] }),
      ];

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        jsonResponse({ records: units })
      );

      const result = await fetchUnitsByTool("recTOOL1");

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("recU1");
      expect(result[1].id).toBe("recU3");
    });

    it("returns empty array when no units match", async () => {
      const units = [makeUnit("recU1", { tool: ["recTOOL_OTHER"] })];

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        jsonResponse({ records: units })
      );

      const result = await fetchUnitsByTool("recTOOL1");

      expect(result).toHaveLength(0);
    });

    it("handles units with no tool field", async () => {
      const units = [makeUnit("recU1", { tool: undefined })];

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        jsonResponse({ records: units })
      );

      const result = await fetchUnitsByTool("recTOOL1");

      expect(result).toHaveLength(0);
    });
  });

  // ── resolveTools ───────────────────────────────────────────────

  describe("resolveTools", () => {
    it("correctly joins categories and locations", () => {
      const tools = [makeTool()];
      const categories = [
        makeCategory("recCAT1", { name: "Saws", group: "Woodworking" }),
      ];
      const locations = [
        makeLocation("recLOC1", { name: "Zone A", room: "Room 101" }),
      ];

      const result = resolveTools(tools, categories, locations);

      expect(result).toHaveLength(1);
      expect(result[0].category_group).toBe("Woodworking");
      expect(result[0].category_sub).toBe("Saws");
      expect(result[0].location_room).toBe("Room 101");
      expect(result[0].location_zone).toBe("Zone A");
    });

    it("handles missing category gracefully", () => {
      const tools = [makeTool({ category: ["recNONEXISTENT"] })];

      const result = resolveTools(tools, [], []);

      expect(result[0].category_group).toBe("Uncategorized");
      expect(result[0].category_sub).toBe("Other");
    });

    it("handles missing location gracefully", () => {
      const tools = [makeTool({ location: ["recNONEXISTENT"] })];

      const result = resolveTools(tools, [], []);

      expect(result[0].location_room).toBe("Unknown");
      expect(result[0].location_zone).toBe("Unknown");
    });

    it("handles tools with no category or location fields", () => {
      const tools = [makeTool({ category: undefined, location: undefined })];

      const result = resolveTools(tools, [], []);

      expect(result[0].category_group).toBe("Uncategorized");
      expect(result[0].category_sub).toBe("Other");
      expect(result[0].location_room).toBe("Unknown");
      expect(result[0].location_zone).toBe("Unknown");
    });

    it("defaults optional fields to safe values", () => {
      const tools = [
        makeTool({
          description: undefined,
          materials: undefined,
          ppe_required: undefined,
          tags: undefined,
          authorized_only: undefined,
          training_required: undefined,
          use_restrictions: undefined,
          emergency_stop: undefined,
          notes: undefined,
          safety_doc_url: undefined,
          sop_url: undefined,
          video_url: undefined,
          map_tag: undefined,
          image_attachments: undefined,
          generated_image: undefined,
          manual_attachments: undefined,
        }),
      ];

      const result = resolveTools(tools, [], []);

      expect(result[0].description).toBe("");
      expect(result[0].materials).toEqual([]);
      expect(result[0].ppe_required).toEqual([]);
      expect(result[0].tags).toEqual([]);
      expect(result[0].authorized_only).toBe(false);
      expect(result[0].training_required).toBe(false);
      expect(result[0].use_restrictions).toBeNull();
      expect(result[0].emergency_stop).toBeNull();
      expect(result[0].notes).toBeNull();
      expect(result[0].safety_doc_url).toBeNull();
      expect(result[0].sop_url).toBeNull();
      expect(result[0].video_url).toBeNull();
      expect(result[0].map_tag).toBeNull();
      expect(result[0].image_attachments).toEqual([]);
      expect(result[0].generated_image).toEqual([]);
      expect(result[0].manual_attachments).toEqual([]);
    });

    it("uses Airtable image URL by default (USE_LOCAL_TOOL_IMAGES not set)", () => {
      const tools = [
        makeTool({
          image_attachments: [
            {
              id: "att1",
              url: "https://airtable.com/img.png",
              filename: "img.png",
              size: 1000,
              type: "image/png",
              thumbnails: {
                small: { url: "https://airtable.com/small.png", width: 100, height: 100 },
                large: { url: "https://airtable.com/large.png", width: 500, height: 500 },
              },
            },
          ],
        }),
      ];

      const result = resolveTools(tools, [], []);

      expect(result[0].image_url).toBe("https://airtable.com/large.png");
    });

    it("returns null image_url when no image attachments exist", () => {
      const tools = [makeTool({ image_attachments: undefined })];

      const result = resolveTools(tools, [], []);

      expect(result[0].image_url).toBeNull();
    });
  });

  // ── createMaintenanceLog ───────────────────────────────────────

  describe("createMaintenanceLog", () => {
    it("sends correct payload and returns created record", async () => {
      const createdRecord = {
        id: "recLOG1",
        createdTime: "2025-01-01T00:00:00.000Z",
        fields: {
          title: "Blade chipped",
          unit: ["recU1"],
          type: "Issue Report",
          priority: "High",
          status: "Open",
          description: "The blade is chipped on the left side.",
        },
      };

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        jsonResponse(createdRecord)
      );

      const result = await createMaintenanceLog({
        title: "Blade chipped",
        unit: ["recU1"],
        type: "Issue Report",
        priority: "High",
        status: "Open",
        description: "The blade is chipped on the left side.",
      });

      expect(result.id).toBe("recLOG1");
      expect(result.fields.title).toBe("Blade chipped");

      // Verify the POST body
      const calledOptions = vi.mocked(globalThis.fetch).mock.calls[0][1] as RequestInit;
      expect(calledOptions.method).toBe("POST");

      const sentBody = JSON.parse(calledOptions.body as string);
      expect(sentBody.fields.title).toBe("Blade chipped");
      expect(sentBody.fields.unit).toEqual(["recU1"]);
      expect(sentBody.fields.priority).toBe("High");
    });

    it("throws on API error during creation", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response("INVALID_REQUEST", { status: 422 })
      );

      await expect(
        createMaintenanceLog({ title: "Bad log" })
      ).rejects.toThrow("AirTable API 422");
    });
  });

  // ── Rate limit retry (429) ─────────────────────────────────────

  describe("rate limit retry", () => {
    it("retries once on 429, then succeeds", async () => {
      const tool = makeTool();

      vi.mocked(globalThis.fetch)
        .mockResolvedValueOnce(
          new Response("Rate limited", {
            status: 429,
            headers: { "Retry-After": "0" },
          })
        )
        .mockResolvedValueOnce(jsonResponse(tool));

      const result = await fetchTool("recTEST123");

      expect(result.fields.name).toBe("Test Tool");
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it("uses Retry-After header delay value", async () => {
      vi.useFakeTimers();
      const tool = makeTool();

      vi.mocked(globalThis.fetch)
        .mockResolvedValueOnce(
          new Response("Rate limited", {
            status: 429,
            headers: { "Retry-After": "1" },
          })
        )
        .mockResolvedValueOnce(jsonResponse(tool));

      const resultPromise = fetchTool("recTEST123");

      // Advance past the 1-second retry delay
      await vi.advanceTimersByTimeAsync(1000);

      const result = await resultPromise;

      expect(result.fields.name).toBe("Test Tool");
      vi.useRealTimers();
    });

    it("defaults to 2000ms delay when no Retry-After header", async () => {
      vi.useFakeTimers();
      const tool = makeTool();

      vi.mocked(globalThis.fetch)
        .mockResolvedValueOnce(
          new Response("Rate limited", { status: 429 })
        )
        .mockResolvedValueOnce(jsonResponse(tool));

      const resultPromise = fetchTool("recTEST123");

      // Advance past the default 2-second retry delay
      await vi.advanceTimersByTimeAsync(2000);

      const result = await resultPromise;

      expect(result.fields.name).toBe("Test Tool");
      vi.useRealTimers();
    });
  });
});
