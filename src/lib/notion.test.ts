/* eslint-disable @typescript-eslint/no-explicit-any -- a couple of assertions
   capture the raw Notion write payload (a heterogeneous property bag) and read
   fields off it; `any` is the pragmatic type for that inspection. */
import { http, HttpResponse } from "msw";

import { server } from "../../test/msw/server";
import { DB_IDS } from "../../test/msw/handlers";
import {
  toolsPage,
  maintenanceLogsPage,
  notionQueryResponse,
  STALE_IMAGE_URL,
  FRESH_IMAGE_URL,
  type NotionPageFixture,
} from "../../test/fixtures/notion";

import {
  fetchAllTools,
  fetchTool,
  fetchAllCategories,
  fetchAllLocations,
  fetchAllUnits,
  fetchAllResources,
  fetchUnit,
  fetchMaintenanceLogsByUnit,
  createMaintenanceLog,
  resolveTools,
  getNotionEnvContract,
} from "@/lib/notion";

import type {
  CategoryRecord,
  LocationRecord,
  ToolRecord,
} from "@/lib/types";

const NOTION = "https://api.notion.com/v1";

// Local page-envelope builder (the fixture module keeps its `page` helper
// private). Properties are loosely typed so each test can hand-craft the exact
// Notion property shapes its parser case needs.
function _page(
  id: string,
  properties: Record<string, unknown>
): NotionPageFixture {
  return {
    object: "page",
    id,
    created_time: "2024-08-12T10:00:00.000Z",
    last_edited_time: "2024-08-12T10:00:00.000Z",
    properties,
  };
}

// Stub all 8 Notion env vars so notion.ts routes its requests at the DB_IDS
// sentinels the default MSW handlers expect. Auto-undone by vitest.setup.ts.
function stubNotionEnv() {
  vi.stubEnv("NOTION_API_KEY", "secret_test");
  vi.stubEnv("NOTION_DB_TOOLS", DB_IDS.tools);
  vi.stubEnv("NOTION_DB_CATEGORIES", DB_IDS.categories);
  vi.stubEnv("NOTION_DB_LOCATIONS", DB_IDS.locations);
  vi.stubEnv("NOTION_DB_UNITS", DB_IDS.units);
  vi.stubEnv("NOTION_DB_RESOURCES", DB_IDS.resources);
  vi.stubEnv("NOTION_DB_MAINTENANCE_LOGS", DB_IDS.maintenance_logs);
  vi.stubEnv("NOTION_DB_FLAGS", DB_IDS.flags);
}

// ─────────────────────────────────────────────────────────────────────
// Parsers (via the fetchers, which call pageToX under the hood)
// ─────────────────────────────────────────────────────────────────────

describe("pageToX parsers", () => {
  beforeEach(stubNotionEnv);

  it("pageToTool extracts title/rich_text/select/multi_select/relation/checkbox/files", async () => {
    const [tool] = await fetchAllTools();

    expect(tool.id).toBe("tool-1");
    expect(tool.fields.name).toBe("Form 4");
    expect(tool.fields.description).toBe("A production-grade resin printer.");
    // relation → array of ids
    expect(tool.fields.category).toEqual(["cat-1"]);
    expect(tool.fields.location).toEqual(["loc-1"]);
    // multi_select → array of names
    expect(tool.fields.materials).toEqual(["Standard resin", "Tough resin"]);
    expect(tool.fields.ppe_required).toEqual(["Nitrile gloves", "Safety glasses"]);
    expect(tool.fields.tags).toEqual(["Resin", "SLA"]);
    // checkbox → boolean
    expect(tool.fields.training_required).toBe(true);
    expect(tool.fields.published).toBe(true);
    expect(tool.fields.use_restrictions).toBe("Resin handling training required.");
    expect(tool.fields.emergency_stop).toBe("Lift the lid to halt the print.");
    expect(tool.fields.notes).toBe("Always wear nitrile gloves.");
    // files → both external files extracted, external.url read
    expect(tool.fields.image_attachments).toHaveLength(2);
    expect(tool.fields.image_attachments?.[0]).toMatchObject({
      id: "tool-1:image_attachments:0",
      url: STALE_IMAGE_URL,
      filename: "stale.png",
    });
    expect(tool.fields.image_attachments?.[1]).toMatchObject({
      url: FRESH_IMAGE_URL,
      filename: "fresh.png",
    });
  });

  it("pageToCategory extracts title + select", async () => {
    const [cat] = await fetchAllCategories();
    expect(cat.id).toBe("cat-1");
    expect(cat.fields.name).toBe("Resin");
    expect(cat.fields.group).toBe("3D Printing");
  });

  it("pageToLocation reads the human id from the title and selects for zone/room", async () => {
    const [loc] = await fetchAllLocations();
    expect(loc.id).toBe("loc-1"); // notion page id
    expect(loc.fields.id).toBe("ML-RESIN-01"); // title value
    expect(loc.fields.zone).toBe("Resin Bench");
    expect(loc.fields.room).toBe("MakerLab");
  });

  it("pageToUnit extracts label/relation/rich_text/select", async () => {
    const [unit] = await fetchAllUnits();
    expect(unit.id).toBe("unit-1");
    expect(unit.fields.unit_label).toBe("Form 4 #1");
    expect(unit.fields.tool).toEqual(["tool-1"]);
    expect(unit.fields.serial_number).toBe("ML-F4-001");
    expect(unit.fields.asset_tag).toBe("AT-0001");
    expect(unit.fields.status).toBe("Available");
    expect(unit.fields.condition).toBe("Excellent");
    expect(unit.fields.date_acquired).toBe("2024-08-12");
    expect(unit.fields.notes).toBe("Primary resin unit.");
  });

  it("pageToResource extracts title/select/url/files and skips files without urls", async () => {
    const [res] = await fetchAllResources();
    expect(res.id).toBe("res-1");
    expect(res.fields.title).toBe("Form 4 SOP");
    expect(res.fields.tool).toEqual(["tool-1"]);
    expect(res.fields.type).toBe("SOP");
    expect(res.fields.url).toBe("https://example.com/form4-sop");
    expect(res.fields.notes).toBe("Standard operating procedure.");
    expect(res.fields.published).toBe(true);
    // one external + one hosted file → both extracted (external.url / file.url)
    expect(res.fields.files).toHaveLength(2);
    expect(res.fields.files?.[0]).toMatchObject({
      url: "https://example.com/form4-manual.pdf",
      filename: "form4-manual.pdf",
    });
    expect(res.fields.files?.[1]).toMatchObject({
      url: "https://files.notion.so/safety.png",
      filename: "safety.png",
    });
  });

  it("pageToMaintenanceLog extracts title/relation/select/rich_text/date/files", async () => {
    const [log] = await fetchMaintenanceLogsByUnit("unit-1");
    expect(log.id).toBe("log-1");
    expect(log.fields.title).toBe("Resin tank cloudy");
    expect(log.fields.unit).toEqual(["unit-1"]);
    expect(log.fields.type).toBe("Issue Report");
    expect(log.fields.priority).toBe("Medium");
    expect(log.fields.status).toBe("Open");
    expect(log.fields.reported_by).toBe("Ada Lovelace");
    expect(log.fields.assigned_to).toBe("Lab Staff");
    expect(log.fields.description).toBe(
      "The resin tank looks cloudy after the last print."
    );
    // date → start value
    expect(log.fields.date_reported).toBe("2024-09-01");
    // empty date → ""
    expect(log.fields.date_resolved).toBe("");
    // empty rich_text → ""
    expect(log.fields.resolution).toBe("");
    expect(log.fields.photo_attachments).toHaveLength(1);
    expect(log.fields.photo_attachments?.[0]).toMatchObject({
      url: "https://example.com/photo.jpg",
      filename: "photo.jpg",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// Header-case fallback names ("Name" vs "name")
// ─────────────────────────────────────────────────────────────────────

describe("header-case property fallbacks", () => {
  beforeEach(stubNotionEnv);

  it("resolves a tool whose properties use Header Case keys", async () => {
    const headerTool = _page("tool-hdr", {
      Name: { type: "title", title: [{ plain_text: "Bandsaw" }] },
      Description: { type: "rich_text", rich_text: [{ plain_text: "Cuts wood." }] },
      Category: { type: "relation", relation: [{ id: "cat-x" }] },
      Materials: { type: "multi_select", multi_select: [{ name: "Wood" }] },
      "PPE Required": { type: "multi_select", multi_select: [{ name: "Goggles" }] },
      "Training Required": { type: "checkbox", checkbox: false },
      Published: { type: "checkbox", checkbox: true },
    });
    server.use(
      http.post(`${NOTION}/databases/:id/query`, () =>
        HttpResponse.json(notionQueryResponse([headerTool]))
      )
    );

    const [tool] = await fetchAllTools();
    expect(tool.fields.name).toBe("Bandsaw");
    expect(tool.fields.description).toBe("Cuts wood.");
    expect(tool.fields.category).toEqual(["cat-x"]);
    expect(tool.fields.materials).toEqual(["Wood"]);
    expect(tool.fields.ppe_required).toEqual(["Goggles"]);
    expect(tool.fields.training_required).toBe(false);
  });

  it("resolves a unit whose label falls back to the Name title", async () => {
    const headerUnit = _page("unit-hdr", {
      Name: { type: "title", title: [{ plain_text: "Bandsaw // A" }] },
      Status: { type: "select", select: { name: "In Use" } },
    });
    server.use(
      http.post(`${NOTION}/databases/:id/query`, () =>
        HttpResponse.json(notionQueryResponse([headerUnit]))
      )
    );

    const [unit] = await fetchAllUnits();
    expect(unit.fields.unit_label).toBe("Bandsaw // A");
    expect(unit.fields.status).toBe("In Use");
  });
});

// ─────────────────────────────────────────────────────────────────────
// multiSelectValue comma-string fallback
// ─────────────────────────────────────────────────────────────────────

describe("multiSelectValue comma-string fallback", () => {
  beforeEach(stubNotionEnv);

  it("splits a rich_text 'a, b, c' value into trimmed tokens", async () => {
    const tool = _page("tool-csv", {
      name: { type: "title", title: [{ plain_text: "CSV tool" }] },
      // materials provided as rich_text rather than multi_select
      materials: { type: "rich_text", rich_text: [{ plain_text: "Wood,  Acrylic , MDF" }] },
    });
    server.use(
      http.post(`${NOTION}/databases/:id/query`, () =>
        HttpResponse.json(notionQueryResponse([tool]))
      )
    );

    const [parsed] = await fetchAllTools();
    expect(parsed.fields.materials).toEqual(["Wood", "Acrylic", "MDF"]);
  });

  it("returns [] for an empty rich_text value", async () => {
    const tool = _page("tool-empty", {
      name: { type: "title", title: [{ plain_text: "Empty" }] },
      materials: { type: "rich_text", rich_text: [] },
    });
    server.use(
      http.post(`${NOTION}/databases/:id/query`, () =>
        HttpResponse.json(notionQueryResponse([tool]))
      )
    );

    const [parsed] = await fetchAllTools();
    expect(parsed.fields.materials).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// fileAttachments — external vs hosted url + filename fallback
// ─────────────────────────────────────────────────────────────────────

describe("fileAttachments", () => {
  beforeEach(stubNotionEnv);

  it("reads external.url for external files and file.url for hosted, deriving filename from url when name is absent", async () => {
    const res = _page("res-files", {
      title: { type: "title", title: [{ plain_text: "Files" }] },
      // external file with no name → filename from url tail
      // hosted file with no name → filename from url tail
      files: {
        type: "files",
        files: [
          { type: "external", external: { url: "https://cdn.example.com/docs/manual.pdf" } },
          { type: "file", file: { url: "https://files.notion.so/path/guide.png" } },
        ],
      },
    });
    server.use(
      http.post(`${NOTION}/databases/:id/query`, () =>
        HttpResponse.json(notionQueryResponse([res]))
      )
    );

    const [parsed] = await fetchAllResources();
    expect(parsed.fields.files).toHaveLength(2);
    expect(parsed.fields.files?.[0]).toMatchObject({
      url: "https://cdn.example.com/docs/manual.pdf",
      filename: "manual.pdf",
    });
    expect(parsed.fields.files?.[1]).toMatchObject({
      url: "https://files.notion.so/path/guide.png",
      filename: "guide.png",
    });
  });

  it("skips files that have no url", async () => {
    const res = _page("res-nofile", {
      title: { type: "title", title: [{ plain_text: "No url" }] },
      files: {
        type: "files",
        files: [
          { type: "external", external: {} },
          { type: "external", external: { url: "https://example.com/ok.pdf" } },
        ],
      },
    });
    server.use(
      http.post(`${NOTION}/databases/:id/query`, () =>
        HttpResponse.json(notionQueryResponse([res]))
      )
    );

    const [parsed] = await fetchAllResources();
    expect(parsed.fields.files).toHaveLength(1);
    expect(parsed.fields.files?.[0].url).toBe("https://example.com/ok.pdf");
  });
});

// ─────────────────────────────────────────────────────────────────────
// resolveTools — joins, defaults, stale-image filtering
// ─────────────────────────────────────────────────────────────────────

describe("resolveTools", () => {
  const category: CategoryRecord = {
    id: "cat-1",
    createdTime: "t",
    lastEditedTime: "t",
    fields: { name: "Resin", group: "3D Printing" },
  };
  const location: LocationRecord = {
    id: "loc-1",
    createdTime: "t",
    lastEditedTime: "t",
    fields: { id: "ML-RESIN-01", zone: "Resin Bench", room: "MakerLab" },
  };

  function toolRecord(overrides: Partial<ToolRecord["fields"]> = {}): ToolRecord {
    return {
      id: "tool-1",
      createdTime: "t",
      lastEditedTime: "t",
      fields: {
        name: "Form 4",
        category: ["cat-1"],
        location: ["loc-1"],
        ...overrides,
      },
    };
  }

  it("joins category group/sub and location room/zone/map_tag", () => {
    const [resolved] = resolveTools([toolRecord()], [category], [location]);
    expect(resolved.category_group).toBe("3D Printing");
    expect(resolved.category_sub).toBe("Resin");
    expect(resolved.location_room).toBe("MakerLab");
    expect(resolved.location_zone).toBe("Resin Bench");
    // map_tag is the location's human id field, not the notion page id.
    expect(resolved.map_tag).toBe("ML-RESIN-01");
  });

  it("applies defaults when relations are missing", () => {
    const [resolved] = resolveTools(
      [toolRecord({ category: [], location: undefined })],
      [],
      []
    );
    expect(resolved.category_group).toBe("Uncategorized");
    expect(resolved.category_sub).toBe("Other");
    expect(resolved.location_room).toBe("Unknown");
    expect(resolved.location_zone).toBe("Unknown");
    expect(resolved.map_tag).toBeNull();
  });

  it("drops a stale airtableusercontent.com image_url (first attachment stale → null)", () => {
    const [resolved] = resolveTools(
      [
        toolRecord({
          image_attachments: [
            { id: "a", url: STALE_IMAGE_URL, filename: "s.png", size: 0, type: "" },
          ],
        }),
      ],
      [category],
      [location]
    );
    expect(resolved.image_url).toBeNull();
  });

  it("keeps a fresh image_url when the first attachment is not stale", () => {
    const [resolved] = resolveTools(
      [
        toolRecord({
          image_attachments: [
            { id: "a", url: FRESH_IMAGE_URL, filename: "f.png", size: 0, type: "" },
          ],
        }),
      ],
      [category],
      [location]
    );
    expect(resolved.image_url).toBe(FRESH_IMAGE_URL);
  });

  it("prefers a fresh large thumbnail over a stale base url", () => {
    const [resolved] = resolveTools(
      [
        toolRecord({
          image_attachments: [
            {
              id: "a",
              url: STALE_IMAGE_URL,
              filename: "s.png",
              size: 0,
              type: "",
              thumbnails: {
                small: { url: STALE_IMAGE_URL, width: 1, height: 1 },
                large: { url: FRESH_IMAGE_URL, width: 2, height: 2 },
              },
            },
          ],
        }),
      ],
      [category],
      [location]
    );
    expect(resolved.image_url).toBe(FRESH_IMAGE_URL);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Pagination (next_cursor)
// ─────────────────────────────────────────────────────────────────────

describe("pagination via next_cursor", () => {
  beforeEach(stubNotionEnv);

  it("concatenates results across pages, following next_cursor", async () => {
    const pageOne = _page("tool-a", {
      name: { type: "title", title: [{ plain_text: "Tool A" }] },
    });
    const pageTwo = _page("tool-b", {
      name: { type: "title", title: [{ plain_text: "Tool B" }] },
    });

    const cursorsSeen: (string | undefined)[] = [];
    server.use(
      http.post(`${NOTION}/databases/:id/query`, async ({ request }) => {
        const body = (await request.json()) as { start_cursor?: string };
        cursorsSeen.push(body.start_cursor);
        if (!body.start_cursor) {
          return HttpResponse.json(
            notionQueryResponse([pageOne], { hasMore: true, nextCursor: "cursor-2" })
          );
        }
        return HttpResponse.json(notionQueryResponse([pageTwo]));
      })
    );

    const tools = await fetchAllTools();
    expect(tools.map((t) => t.fields.name)).toEqual(["Tool A", "Tool B"]);
    // first request has no cursor, second sends the cursor from page 1
    expect(cursorsSeen).toEqual([undefined, "cursor-2"]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 429 retry-after handling
// ─────────────────────────────────────────────────────────────────────

describe("429 Retry-After handling", () => {
  beforeEach(stubNotionEnv);

  it("retries once after a 429 then resolves", async () => {
    let calls = 0;
    server.use(
      http.post(`${NOTION}/databases/:id/query`, () => {
        calls += 1;
        if (calls === 1) {
          // Retry-After 0 → no real wait, keeps the test fast & reliable.
          return new HttpResponse(null, {
            status: 429,
            headers: { "Retry-After": "0" },
          });
        }
        return HttpResponse.json(notionQueryResponse([toolsPage]));
      })
    );

    const tools = await fetchAllTools();
    expect(calls).toBe(2);
    expect(tools[0].fields.name).toBe("Form 4");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Env contract + missing-var errors
// ─────────────────────────────────────────────────────────────────────

describe("Notion env contract", () => {
  it("getNotionEnvContract returns the 8 expected keys", () => {
    expect(getNotionEnvContract()).toEqual([
      "NOTION_API_KEY",
      "NOTION_DB_TOOLS",
      "NOTION_DB_CATEGORIES",
      "NOTION_DB_LOCATIONS",
      "NOTION_DB_UNITS",
      "NOTION_DB_RESOURCES",
      "NOTION_DB_MAINTENANCE_LOGS",
      "NOTION_DB_FLAGS",
    ]);
  });

  it("throws listing every missing var when env is fully unset", async () => {
    // No env stubbed → getNotionEnv (reached via fetchAllTools) should throw.
    // queryDatabase calls getNotionEnv before any fetch, so this rejects.
    await expect(fetchAllTools()).rejects.toThrow(/Missing Notion catalog env vars/);
    await expect(fetchAllTools()).rejects.toThrow(/NOTION_API_KEY/);
    await expect(fetchAllTools()).rejects.toThrow(/NOTION_DB_TOOLS/);
    await expect(fetchAllTools()).rejects.toThrow(/NOTION_DB_FLAGS/);
  });

  it("lists only the specific missing var when others are present", async () => {
    vi.stubEnv("NOTION_API_KEY", "secret_test");
    vi.stubEnv("NOTION_DB_TOOLS", DB_IDS.tools);
    vi.stubEnv("NOTION_DB_CATEGORIES", DB_IDS.categories);
    vi.stubEnv("NOTION_DB_LOCATIONS", DB_IDS.locations);
    vi.stubEnv("NOTION_DB_UNITS", DB_IDS.units);
    vi.stubEnv("NOTION_DB_RESOURCES", DB_IDS.resources);
    vi.stubEnv("NOTION_DB_MAINTENANCE_LOGS", DB_IDS.maintenance_logs);
    // NOTION_DB_FLAGS intentionally left unset.

    await expect(fetchAllTools()).rejects.toThrow(
      /Missing Notion catalog env vars: NOTION_DB_FLAGS/
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// createMaintenanceLog — POST body shape
// ─────────────────────────────────────────────────────────────────────

describe("createMaintenanceLog", () => {
  beforeEach(stubNotionEnv);

  it("posts to /pages with correct parent.database_id and properties shape", async () => {
    let captured: any;
    server.use(
      http.post(`${NOTION}/pages`, async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json({
          object: "page",
          id: "created-page-1",
          created_time: "2024-09-01T10:00:00.000Z",
          last_edited_time: "2024-09-01T10:00:00.000Z",
          properties: captured.properties ?? {},
        });
      })
    );

    const result = await createMaintenanceLog({
      title: "Laser not cutting",
      unit: ["unit-1"],
      type: "Issue Report",
      priority: "High",
      status: "Open",
      reported_by: "Grace Hopper",
      description: "The laser fails to cut through 3mm acrylic.",
      date_reported: "2024-09-02",
      photo_uploads: [{ id: "file-upload-1", name: "evidence.jpg" }],
    });

    // parent points at the maintenance_logs database id
    expect(captured.parent).toEqual({ database_id: DB_IDS.maintenance_logs });

    const props = captured.properties;
    // title
    expect(props.title).toEqual({ title: [{ text: { content: "Laser not cutting" } }] });
    // relation for unit
    expect(props.unit).toEqual({ relation: [{ id: "unit-1" }] });
    // selects for type/priority/status
    expect(props.type).toEqual({ select: { name: "Issue Report" } });
    expect(props.priority).toEqual({ select: { name: "High" } });
    expect(props.status).toEqual({ select: { name: "Open" } });
    // reported_by rich_text
    expect(props.reported_by).toEqual({
      rich_text: [{ text: { content: "Grace Hopper" } }],
    });
    // date
    expect(props.date_reported).toEqual({ date: { start: "2024-09-02" } });
    // file_upload files
    expect(props.photo_attachments).toEqual({
      files: [
        {
          type: "file_upload",
          file_upload: { id: "file-upload-1" },
          name: "evidence.jpg",
        },
      ],
    });

    // description is the templated ticket description built by formatTicketDescription
    const desc = props.description.rich_text[0].text.content as string;
    expect(desc).toContain("**What happened**");
    expect(desc).toContain("The laser fails to cut through 3mm acrylic.");
    expect(desc).toContain("**Reported by**");
    expect(desc).toContain("Grace Hopper");
    expect(desc).toContain("**Date reported**");
    expect(desc).toContain("2024-09-02");
    expect(desc).toContain("**Priority**");
    expect(desc).toContain("High");

    // returns a parsed record
    expect(result.id).toBe("created-page-1");
  });

  it("defaults the title and omits optional props when fields are sparse", async () => {
    let captured: any;
    server.use(
      http.post(`${NOTION}/pages`, async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json({
          object: "page",
          id: "created-page-2",
          created_time: "t",
          last_edited_time: "t",
          properties: captured.properties ?? {},
        });
      })
    );

    await createMaintenanceLog({});

    expect(captured.properties.title).toEqual({
      title: [{ text: { content: "Untitled issue" } }],
    });
    // no description sections → description prop omitted
    expect(captured.properties.description).toBeUndefined();
    expect(captured.properties.unit).toBeUndefined();
    expect(captured.properties.type).toBeUndefined();
    expect(captured.properties.photo_attachments).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────
// fetchAllTools published-filter fallback chain
// ─────────────────────────────────────────────────────────────────────

describe("fetchAllTools published-filter fallback", () => {
  beforeEach(stubNotionEnv);

  it("returns mapped tools on the happy path (lowercase published filter)", async () => {
    const tools = await fetchAllTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].fields.name).toBe("Form 4");
  });

  it("falls back through the filter chain when earlier queries fail", async () => {
    let attempt = 0;
    server.use(
      http.post(`${NOTION}/databases/:id/query`, async ({ request }) => {
        const body = (await request.json()) as {
          filter?: { property?: string };
          sorts?: unknown;
        };
        attempt += 1;
        // First two attempts (published / Published filters) 400, third
        // (sort-only) succeeds.
        if (body.filter) {
          return new HttpResponse("bad filter", { status: 400 });
        }
        return HttpResponse.json(notionQueryResponse([toolsPage]));
      })
    );

    const tools = await fetchAllTools();
    expect(attempt).toBeGreaterThanOrEqual(3);
    expect(tools[0].fields.name).toBe("Form 4");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Single-page fetchers (GET /pages/:id)
// ─────────────────────────────────────────────────────────────────────

describe("single-page fetchers", () => {
  beforeEach(stubNotionEnv);

  it("fetchTool fetches and parses a single page", async () => {
    const tool = await fetchTool("tool-1");
    expect(tool.fields.name).toBe("Form 4");
  });

  it("fetchUnit fetches and parses a single unit page", async () => {
    const unit = await fetchUnit("unit-1");
    expect(unit.fields.unit_label).toBe("Form 4 #1");
  });
});

// ─────────────────────────────────────────────────────────────────────
// fetchMaintenanceLogsByUnit — relation filter
// ─────────────────────────────────────────────────────────────────────

describe("fetchMaintenanceLogsByUnit", () => {
  beforeEach(stubNotionEnv);

  it("returns logs whose unit relation includes the requested unit id", async () => {
    const logs = await fetchMaintenanceLogsByUnit("unit-1");
    expect(logs).toHaveLength(1);
    expect(logs[0].fields.title).toBe("Resin tank cloudy");
  });

  it("filters out logs that do not reference the requested unit", async () => {
    const otherLog = _page("log-other", {
      title: { type: "title", title: [{ plain_text: "Other unit issue" }] },
      unit: { type: "relation", relation: [{ id: "unit-999" }] },
    });
    server.use(
      http.post(`${NOTION}/databases/:id/query`, () =>
        HttpResponse.json(notionQueryResponse([otherLog, maintenanceLogsPage]))
      )
    );

    const logs = await fetchMaintenanceLogsByUnit("unit-1");
    expect(logs.map((l) => l.fields.title)).toEqual(["Resin tank cloudy"]);
  });
});
