import { http, HttpResponse } from "msw";

import { server } from "../../test/msw/server";
import { DB_IDS } from "../../test/msw/handlers";
import {
  categoriesPage,
  locationsPage,
  notionQueryResponse,
  resourcesPage,
  toolsPage,
  unitsPage,
  selectProp,
  relationProp,
  titleProp,
  richTextProp,
  checkboxProp,
  multiSelectProp,
  filesProp,
  externalFile,
  hostedFile,
  urlProp,
  STALE_IMAGE_URL,
  FRESH_IMAGE_URL,
  type NotionPageFixture,
} from "../../test/fixtures/notion";
import { nextCacheMock } from "../../test/mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());

// ── Helpers ─────────────────────────────────────────────────────────

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

function unsetNotionEnv() {
  vi.stubEnv("NOTION_API_KEY", "");
  vi.stubEnv("NOTION_DB_TOOLS", "");
  vi.stubEnv("NOTION_DB_CATEGORIES", "");
  vi.stubEnv("NOTION_DB_LOCATIONS", "");
  vi.stubEnv("NOTION_DB_UNITS", "");
  vi.stubEnv("NOTION_DB_RESOURCES", "");
  vi.stubEnv("NOTION_DB_MAINTENANCE_LOGS", "");
  vi.stubEnv("NOTION_DB_FLAGS", "");
}

// Route the standard catalog DBs to a custom set of pages. tools / categories /
// locations / units / resources can each be overridden; anything else returns
// empty. Used to drive status + training-level derivation through the real path.
function routeCatalog(opts: {
  tools?: NotionPageFixture[];
  categories?: NotionPageFixture[];
  locations?: NotionPageFixture[];
  units?: NotionPageFixture[];
  resources?: NotionPageFixture[];
}) {
  const byId: Record<string, NotionPageFixture[]> = {
    [DB_IDS.tools]: opts.tools ?? [toolsPage],
    [DB_IDS.categories]: opts.categories ?? [categoriesPage],
    [DB_IDS.locations]: opts.locations ?? [locationsPage],
    [DB_IDS.units]: opts.units ?? [unitsPage],
    [DB_IDS.resources]: opts.resources ?? [resourcesPage],
  };
  server.use(
    http.post("https://api.notion.com/v1/databases/:id/query", ({ params }) => {
      const id = params.id as string;
      return HttpResponse.json(notionQueryResponse(byId[id] ?? []));
    })
  );
}

// Reset modules + re-import so catalog.ts re-reads process.env at module load.
async function importCatalog() {
  vi.resetModules();
  return import("@/lib/catalog");
}

// ── hasNotionCatalogEnv ─────────────────────────────────────────────

describe("hasNotionCatalogEnv", () => {
  it("returns true when all NOTION_* vars are set", async () => {
    stubNotionEnv();
    const { hasNotionCatalogEnv } = await importCatalog();
    expect(hasNotionCatalogEnv()).toBe(true);
  });

  it("returns false when any NOTION_* var is missing", async () => {
    stubNotionEnv();
    vi.stubEnv("NOTION_DB_UNITS", "");
    const { hasNotionCatalogEnv } = await importCatalog();
    expect(hasNotionCatalogEnv()).toBe(false);
  });

  it("returns false when NOTION_API_KEY is missing", async () => {
    stubNotionEnv();
    vi.stubEnv("NOTION_API_KEY", "");
    const { hasNotionCatalogEnv } = await importCatalog();
    expect(hasNotionCatalogEnv()).toBe(false);
  });
});

// ── getCatalogTools — mock fallback ─────────────────────────────────

describe("getCatalogTools (mock fallback)", () => {
  it("returns the built-in mockTools when Notion env is unset", async () => {
    unsetNotionEnv();
    const catalog = await importCatalog();
    const { mockTools } = await import("@/components/mock-catalog");

    const tools = await catalog.getCatalogTools();
    expect(tools).toBe(mockTools);
    expect(tools.map((t) => t.slug)).toEqual(["form-4", "trotec-speedy-400"]);
  });
});

// ── getCatalogTools — real Notion path ──────────────────────────────

describe("getCatalogTools (Notion path)", () => {
  it("resolves tools from Notion fixtures", async () => {
    stubNotionEnv();
    const { getCatalogTools } = await importCatalog();

    const tools = await getCatalogTools();
    expect(tools).toHaveLength(1);

    const [tool] = tools;
    expect(tool.id).toBe("tool-1");
    expect(tool.slug).toBe("tool-1");
    expect(tool.name).toBe("Form 4");
    // category resolved via relation -> categoriesPage
    expect(tool.category).toBe("3D Printing");
    expect(tool.categorySub).toBe("Resin");
    // location resolved via relation -> locationsPage
    expect(tool.location).toBe("MakerLab");
    expect(tool.zone).toBe("Resin Bench");
    expect(tool.materials).toEqual(["Standard resin", "Tough resin"]);
    expect(tool.ppe).toEqual(["Nitrile gloves", "Safety glasses"]);
    // The first image_attachment is the stale airtable host; pickFreshImageUrl
    // only inspects the *first* attachment's own url candidates and rejects it,
    // so image_url is null and toMakerLabTool falls back to the local path.
    expect(tool.imageSrc).toBe("/tool-images/Form%204.png");
    // mapId from resolved location.id
    expect(tool.mapId).toBe("ML-RESIN-01");
  });

  it("keeps a fresh first-attachment image url and drops a stale one", async () => {
    stubNotionEnv();
    const freshFirst: NotionPageFixture = {
      ...toolsPage,
      properties: {
        ...toolsPage.properties,
        image_attachments: filesProp([externalFile("fresh.png", FRESH_IMAGE_URL)]),
      },
    };
    const staleFirst: NotionPageFixture = {
      ...toolsPage,
      properties: {
        ...toolsPage.properties,
        image_attachments: filesProp([externalFile("stale.png", STALE_IMAGE_URL)]),
      },
    };

    routeCatalog({ tools: [freshFirst] });
    const fresh = await importCatalog();
    expect((await fresh.getCatalogTools())[0].imageSrc).toBe(FRESH_IMAGE_URL);

    routeCatalog({ tools: [staleFirst] });
    const stale = await importCatalog();
    // stale first-attachment rejected -> local fallback
    expect((await stale.getCatalogTools())[0].imageSrc).toBe("/tool-images/Form%204.png");
  });

  it("attaches the unit grouped by tool id", async () => {
    stubNotionEnv();
    const { getCatalogTools } = await importCatalog();

    const [tool] = await getCatalogTools();
    expect(tool.units).toHaveLength(1);
    expect(tool.units[0].name).toBe("Form 4 #1");
    expect(tool.units[0].serial).toBe("ML-F4-001");
  });

  it("falls back to mockTools and warns when the fetch errors (500)", async () => {
    stubNotionEnv();
    server.use(
      http.post("https://api.notion.com/v1/databases/:id/query", () =>
        HttpResponse.json({ message: "boom" }, { status: 500 })
      )
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const catalog = await importCatalog();
    const { mockTools } = await import("@/components/mock-catalog");

    const tools = await catalog.getCatalogTools();
    expect(tools).toBe(mockTools);
    expect(warn).toHaveBeenCalledWith(
      "Falling back to mock catalog:",
      expect.anything()
    );
  });
});

// ── getCatalogTool(id) ──────────────────────────────────────────────

describe("getCatalogTool", () => {
  it("returns the tool found via the Notion path by id", async () => {
    stubNotionEnv();
    const { getCatalogTool } = await importCatalog();

    const tool = await getCatalogTool("tool-1");
    expect(tool).not.toBeNull();
    expect(tool?.name).toBe("Form 4");
    expect(tool?.units).toHaveLength(1);
  });

  it("returns null when the id is not found via the Notion path", async () => {
    stubNotionEnv();
    const { getCatalogTool } = await importCatalog();

    const tool = await getCatalogTool("does-not-exist");
    expect(tool).toBeNull();
  });

  it("resolves a tool by slug from the mock catalog when env is unset", async () => {
    unsetNotionEnv();
    const { getCatalogTool } = await importCatalog();

    const tool = await getCatalogTool("trotec-speedy-400");
    expect(tool?.name).toBe("Trotec Speedy 400");
  });

  it("returns null for an unknown slug in the mock fallback", async () => {
    unsetNotionEnv();
    const { getCatalogTool } = await importCatalog();

    expect(await getCatalogTool("nope")).toBeNull();
  });
});

// ── getCatalogStats ─────────────────────────────────────────────────

describe("getCatalogStats", () => {
  it("counts tools in inventory and reports lab hours (mock path)", async () => {
    unsetNotionEnv();
    const { getCatalogStats } = await importCatalog();

    const stats = await getCatalogStats();
    expect(stats.toolsInInventory).toBe(2);
    expect(stats.labHours).toBe("LAB OPEN 9AM-9PM");
  });

  it("counts tools resolved from the Notion path", async () => {
    stubNotionEnv();
    const { getCatalogStats } = await importCatalog();

    const stats = await getCatalogStats();
    expect(stats.toolsInInventory).toBe(1);
  });
});

// ── Status derivation ───────────────────────────────────────────────

describe("status derivation (via Notion path)", () => {
  const toolNoTraining: NotionPageFixture = {
    ...toolsPage,
    properties: { ...toolsPage.properties, training_required: checkboxProp(false) },
  };

  function unit(id: string, status: string): NotionPageFixture {
    return {
      object: "page",
      id,
      created_time: "2024-08-12T10:00:00.000Z",
      last_edited_time: "2024-08-12T10:00:00.000Z",
      properties: {
        unit_label: titleProp(`Unit ${id}`),
        tool: relationProp(["tool-1"]),
        status: selectProp(status),
        condition: selectProp("Good"),
      },
    };
  }

  it('derives "In Use" when any unit is In Use', async () => {
    stubNotionEnv();
    routeCatalog({ units: [unit("u1", "Available"), unit("u2", "In Use")] });
    const { getCatalogTools } = await importCatalog();

    const [tool] = await getCatalogTools();
    expect(tool.status).toBe("In Use");
  });

  it('derives "Offline" when all units are Offline (Out of Service)', async () => {
    stubNotionEnv();
    routeCatalog({ units: [unit("u1", "Out of Service"), unit("u2", "Retired")] });
    const { getCatalogTools } = await importCatalog();

    const [tool] = await getCatalogTools();
    expect(tool.status).toBe("Offline");
  });

  it('derives "Training Required" when training_required and no units gate it', async () => {
    stubNotionEnv();
    // toolsPage has training_required: true; give it no units so unit-based
    // status does not apply.
    routeCatalog({ tools: [toolsPage], units: [] });
    const { getCatalogTools } = await importCatalog();

    const [tool] = await getCatalogTools();
    expect(tool.status).toBe("Training Required");
  });

  it('derives "Available" when no training required and no gating units', async () => {
    stubNotionEnv();
    routeCatalog({ tools: [toolNoTraining], units: [] });
    const { getCatalogTools } = await importCatalog();

    const [tool] = await getCatalogTools();
    expect(tool.status).toBe("Available");
  });
});

// ── Training level / label derivation ───────────────────────────────

describe("training level + label derivation (via Notion path)", () => {
  function toolWith(props: Record<string, unknown>): NotionPageFixture {
    return { ...toolsPage, properties: { ...toolsPage.properties, ...props } };
  }

  it('derives "Advanced" when restrictions mention "authorized"', async () => {
    stubNotionEnv();
    routeCatalog({
      tools: [toolWith({ use_restrictions: richTextProp("Authorized users only.") })],
      units: [],
    });
    const { getCatalogTools } = await importCatalog();

    const [tool] = await getCatalogTools();
    expect(tool.trainingLevel).toBe("Advanced");
    // training_required true + use_restrictions set -> label is the restriction
    expect(tool.trainingLabel).toBe("Authorized users only.");
  });

  it('derives "Advanced" when a tag contains "advanced"', async () => {
    stubNotionEnv();
    routeCatalog({
      tools: [
        toolWith({
          use_restrictions: richTextProp(""),
          tags: multiSelectProp(["Advanced", "Laser"]),
        }),
      ],
      units: [],
    });
    const { getCatalogTools } = await importCatalog();

    const [tool] = await getCatalogTools();
    expect(tool.trainingLevel).toBe("Advanced");
  });

  it('derives "Intermediate" when training_required and no advanced keyword', async () => {
    stubNotionEnv();
    // toolsPage: training_required true, restrictions "Resin handling..." (no
    // advanced/authorized keyword), tags Resin/SLA.
    routeCatalog({ tools: [toolsPage], units: [] });
    const { getCatalogTools } = await importCatalog();

    const [tool] = await getCatalogTools();
    expect(tool.trainingLevel).toBe("Intermediate");
    expect(tool.trainingLabel).toBe("Resin handling training required.");
  });

  it('derives "Beginner" when no training required and no keywords', async () => {
    stubNotionEnv();
    routeCatalog({
      tools: [
        toolWith({
          training_required: checkboxProp(false),
          use_restrictions: richTextProp(""),
          tags: multiSelectProp(["Resin"]),
        }),
      ],
      units: [],
    });
    const { getCatalogTools } = await importCatalog();

    const [tool] = await getCatalogTools();
    expect(tool.trainingLevel).toBe("Beginner");
    expect(tool.trainingLabel).toBe("Beginner orientation");
  });
});

// ── resourceLinks ───────────────────────────────────────────────────

describe("resourceLinks (via Notion path)", () => {
  it("emits a url link plus a link per file attachment", async () => {
    stubNotionEnv();
    // Default resourcesPage: url + 2 files (external pdf + hosted png).
    const { getCatalogTool } = await importCatalog();

    const tool = await getCatalogTool("tool-1");
    expect(tool).not.toBeNull();

    const links = tool!.links;
    // 1 url link + 2 file links
    expect(links).toHaveLength(3);

    const urlLink = links.find((l) => l.href === "https://example.com/form4-sop");
    expect(urlLink).toMatchObject({ label: "Form 4 SOP", kind: "SOP" });

    const pdfLink = links.find((l) => l.href === "https://example.com/form4-manual.pdf");
    expect(pdfLink).toBeDefined();
    const pngLink = links.find((l) => l.href === "https://files.notion.so/safety.png");
    expect(pngLink).toBeDefined();
  });

  it("excludes resources where published === false", async () => {
    stubNotionEnv();
    const unpublished: NotionPageFixture = {
      object: "page",
      id: "res-unpublished",
      created_time: "2024-08-12T10:00:00.000Z",
      last_edited_time: "2024-08-12T10:00:00.000Z",
      properties: {
        title: titleProp("Hidden SOP"),
        tool: relationProp(["tool-1"]),
        type: selectProp("SOP"),
        url: urlProp("https://example.com/hidden"),
        files: filesProp([]),
        published: checkboxProp(false),
      },
    };
    routeCatalog({ resources: [unpublished] });
    const { getCatalogTool } = await importCatalog();

    const tool = await getCatalogTool("tool-1");
    expect(tool!.links).toEqual([]);
  });

  it("emits only file links when a resource has files but no url", async () => {
    stubNotionEnv();
    const filesOnly: NotionPageFixture = {
      object: "page",
      id: "res-files-only",
      created_time: "2024-08-12T10:00:00.000Z",
      last_edited_time: "2024-08-12T10:00:00.000Z",
      properties: {
        title: titleProp("Manual"),
        tool: relationProp(["tool-1"]),
        type: selectProp("Manual"),
        url: urlProp(null),
        files: filesProp([
          externalFile("a.pdf", "https://example.com/a.pdf"),
          hostedFile("b.pdf", "https://files.notion.so/b.pdf"),
        ]),
        published: checkboxProp(true),
      },
    };
    routeCatalog({ resources: [filesOnly] });
    const { getCatalogTool } = await importCatalog();

    const tool = await getCatalogTool("tool-1");
    expect(tool!.links).toHaveLength(2);
    expect(tool!.links.every((l) => l.href.endsWith(".pdf"))).toBe(true);
  });
});

// ── units / resources grouping ──────────────────────────────────────

describe("units + resources grouping by tool id", () => {
  it("only attaches units/resources whose relation points at the tool", async () => {
    stubNotionEnv();

    const otherUnit: NotionPageFixture = {
      object: "page",
      id: "unit-other",
      created_time: "2024-08-12T10:00:00.000Z",
      last_edited_time: "2024-08-12T10:00:00.000Z",
      properties: {
        unit_label: titleProp("Other unit"),
        tool: relationProp(["tool-2"]),
        status: selectProp("Available"),
        condition: selectProp("Good"),
      },
    };
    const otherResource: NotionPageFixture = {
      object: "page",
      id: "res-other",
      created_time: "2024-08-12T10:00:00.000Z",
      last_edited_time: "2024-08-12T10:00:00.000Z",
      properties: {
        title: titleProp("Other SOP"),
        tool: relationProp(["tool-2"]),
        type: selectProp("SOP"),
        url: urlProp("https://example.com/other"),
        files: filesProp([]),
        published: checkboxProp(true),
      },
    };

    routeCatalog({
      units: [unitsPage, otherUnit],
      resources: [resourcesPage, otherResource],
    });
    const { getCatalogTool } = await importCatalog();

    const tool = await getCatalogTool("tool-1");
    // only the unit/resource pointing at tool-1 are attached
    expect(tool!.units).toHaveLength(1);
    expect(tool!.units[0].id).toBe("unit-1");
    expect(tool!.links.some((l) => l.href.includes("/other"))).toBe(false);
  });
});
