import { http, HttpResponse } from "msw";

import { server } from "../../test/msw/server";
import {
  checkboxProp,
  externalFile,
  filesProp,
  multiSelectProp,
  notionQueryResponse,
  relationProp,
  richTextProp,
  titleProp,
  urlProp,
  type NotionPageFixture,
} from "../../test/fixtures/notion";
import { nextCacheMock } from "../../test/mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());

// ── Helpers ─────────────────────────────────────────────────────────

const PROJECTS_DB = "db-projects";

// The Projects DB is independent of the catalog env contract: it needs only
// NOTION_API_KEY + NOTION_DB_PROJECTS. The catalog DB ids are deliberately left
// blank so `getCatalogTools()` resolves tool relations against the built-in
// mock catalog (tool-form-4 / tool-trotec-speedy-400) with no network call.
function stubProjectsEnv() {
  vi.stubEnv("NOTION_API_KEY", "secret_test");
  vi.stubEnv("NOTION_DB_PROJECTS", PROJECTS_DB);
  vi.stubEnv("NOTION_DB_TOOLS", "");
  vi.stubEnv("NOTION_DB_CATEGORIES", "");
  vi.stubEnv("NOTION_DB_LOCATIONS", "");
  vi.stubEnv("NOTION_DB_UNITS", "");
  vi.stubEnv("NOTION_DB_RESOURCES", "");
  vi.stubEnv("NOTION_DB_MAINTENANCE_LOGS", "");
  vi.stubEnv("NOTION_DB_FLAGS", "");
}

const TS = "2024-08-12T10:00:00.000Z";

// A raw Projects page. Any property can be overridden — or omitted entirely, to
// exercise the "property absent from the database" path.
function projectPage(
  id: string,
  properties: Record<string, unknown>,
  createdTime = TS
): NotionPageFixture {
  return {
    object: "page",
    id,
    created_time: createdTime,
    last_edited_time: createdTime,
    properties,
  };
}

const fullProject = projectPage("project-1", {
  title: titleProp("Lamp from scrap plywood"),
  author: richTextProp("Ada Lovelace"),
  body: richTextProp("## How I made it\nCut on the laser, glued, sanded."),
  photos: filesProp([
    externalFile("cover.png", "https://files.notion.so/cover.png"),
    externalFile("detail.png", "https://files.notion.so/detail.png"),
  ]),
  // tool-form-4 exists in the mock catalog; tool-deleted does not.
  tools_used: relationProp(["tool-form-4", "tool-deleted"]),
  link: urlProp("https://example.com/lamp"),
  materials: multiSelectProp(["Plywood", "PLA"]),
  published: checkboxProp(true),
});

// Route every Notion DB query to the supplied project pages. `projects.ts` only
// ever queries the Projects DB (the catalog comes from the mock fallback), so a
// single override is enough.
function routeProjects(pages: NotionPageFixture[]) {
  server.use(
    http.post("https://api.notion.com/v1/databases/:id/query", ({ params }) =>
      HttpResponse.json(
        notionQueryResponse(params.id === PROJECTS_DB ? pages : [])
      )
    )
  );
}

// projects.ts reads process.env through function calls (`hasProjectsEnv`), but
// re-importing per test also gives each test a fresh `"use cache"` boundary.
async function importProjects() {
  vi.resetModules();
  return import("@/lib/projects");
}

// ── toMakerLabProject mapping ───────────────────────────────────────

describe("getPublishedProjects (mapping)", () => {
  it("maps a Notion project record onto MakerLabProject", async () => {
    stubProjectsEnv();
    routeProjects([fullProject]);
    const { getPublishedProjects } = await importProjects();

    const [project] = await getPublishedProjects();

    expect(project.id).toBe("project-1");
    expect(project.title).toBe("Lamp from scrap plywood");
    expect(project.author).toBe("Ada Lovelace");
    expect(project.body).toContain("How I made it");
    expect(project.photos).toEqual([
      "https://files.notion.so/cover.png",
      "https://files.notion.so/detail.png",
    ]);
    expect(project.link).toBe("https://example.com/lamp");
    expect(project.materials).toEqual(["Plywood", "PLA"]);
    expect(project.date).toBe(TS);
  });

  it("falls back to Anonymous when the author is empty", async () => {
    stubProjectsEnv();
    routeProjects([
      projectPage("project-anon", {
        title: titleProp("Anonymous build"),
        author: richTextProp(""),
        body: richTextProp("No name on this one."),
        published: checkboxProp(true),
      }),
    ]);
    const { getPublishedProjects } = await importProjects();

    const [project] = await getPublishedProjects();
    expect(project.author).toBe("Anonymous");
  });

  it("falls back to Anonymous when the author property is absent entirely", async () => {
    stubProjectsEnv();
    routeProjects([
      projectPage("project-no-author", {
        title: titleProp("Untitled author"),
        body: richTextProp("Body only."),
        published: checkboxProp(true),
      }),
    ]);
    const { getPublishedProjects } = await importProjects();

    const [project] = await getPublishedProjects();
    expect(project.author).toBe("Anonymous");
  });

  it("returns empty photos/tools/materials when those properties are absent", async () => {
    stubProjectsEnv();
    routeProjects([
      projectPage("project-bare", {
        title: titleProp("Bare project"),
        author: richTextProp("Grace Hopper"),
        body: richTextProp("Just words."),
        published: checkboxProp(true),
      }),
    ]);
    const { getPublishedProjects } = await importProjects();

    const [project] = await getPublishedProjects();
    expect(project.photos).toEqual([]);
    expect(project.tools).toEqual([]);
    expect(project.materials).toEqual([]);
    expect(project.link).toBeNull();
    // No `date` property — falls back to the page's created_time.
    expect(project.date).toBe(TS);
  });

  it("drops tool ids that no longer resolve instead of rendering them broken", async () => {
    stubProjectsEnv();
    routeProjects([fullProject]);
    const { getPublishedProjects } = await importProjects();

    const [project] = await getPublishedProjects();

    // tool-deleted is gone from the catalog; only the resolvable ref survives.
    expect(project.tools).toEqual([
      { id: "tool-form-4", name: "Form 4", slug: "form-4" },
    ]);
  });

  it("resolves tool refs with the slug the tool page is routed by", async () => {
    stubProjectsEnv();
    routeProjects([
      projectPage("project-two-tools", {
        title: titleProp("Two machines"),
        author: richTextProp("Ada"),
        body: richTextProp("Body"),
        tools_used: relationProp(["tool-trotec-speedy-400", "tool-form-4"]),
        published: checkboxProp(true),
      }),
    ]);
    const { getPublishedProjects } = await importProjects();

    const [project] = await getPublishedProjects();
    expect(project.tools.map((tool) => tool.slug)).toEqual([
      "trotec-speedy-400",
      "form-4",
    ]);
  });
});

// ── published filtering ─────────────────────────────────────────────

describe("getPublishedProjects (publish gate)", () => {
  it("excludes records whose published checkbox is unticked", async () => {
    stubProjectsEnv();
    routeProjects([
      fullProject,
      projectPage("project-draft", {
        title: titleProp("Draft build"),
        author: richTextProp("Someone"),
        body: richTextProp("Not reviewed yet."),
        published: checkboxProp(false),
      }),
    ]);
    const { getPublishedProjects } = await importProjects();

    const projects = await getPublishedProjects();
    expect(projects.map((project) => project.id)).toEqual(["project-1"]);
  });

  it("excludes records with no published property at all", async () => {
    stubProjectsEnv();
    routeProjects([
      projectPage("project-unset", {
        title: titleProp("No checkbox"),
        author: richTextProp("Someone"),
        body: richTextProp("Body"),
      }),
    ]);
    const { getPublishedProjects } = await importProjects();

    expect(await getPublishedProjects()).toEqual([]);
  });
});

// ── no env / failure paths ──────────────────────────────────────────

describe("getPublishedProjects (no Projects DB)", () => {
  it("returns an empty array without throwing or calling Notion", async () => {
    vi.stubEnv("NOTION_API_KEY", "");
    vi.stubEnv("NOTION_DB_PROJECTS", "");
    const { getPublishedProjects } = await importProjects();

    // MSW's onUnhandledRequest:"error" would fail this test on any outbound
    // call, so reaching the assertion proves nothing was fetched.
    await expect(getPublishedProjects()).resolves.toEqual([]);
  });

  it("returns an empty array when NOTION_DB_PROJECTS alone is missing", async () => {
    vi.stubEnv("NOTION_API_KEY", "secret_test");
    vi.stubEnv("NOTION_DB_PROJECTS", "");
    const { getPublishedProjects } = await importProjects();

    await expect(getPublishedProjects()).resolves.toEqual([]);
  });

  it("fails toward empty (not toward a thrown page) when Notion errors", async () => {
    stubProjectsEnv();
    server.use(
      http.post("https://api.notion.com/v1/databases/:id/query", () =>
        HttpResponse.json(
          { object: "error", status: 500, message: "internal" },
          { status: 500 }
        )
      )
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { getPublishedProjects } = await importProjects();

    await expect(getPublishedProjects()).resolves.toEqual([]);
    // The failure has to be visible in the logs (Article 4).
    expect(warn).toHaveBeenCalled();
  });
});

// ── getProject ──────────────────────────────────────────────────────

describe("getProject", () => {
  it("returns the published project for a known id", async () => {
    stubProjectsEnv();
    routeProjects([fullProject]);
    const { getProject } = await importProjects();

    const project = await getProject("project-1");
    expect(project?.title).toBe("Lamp from scrap plywood");
  });

  it("returns null for an unknown id", async () => {
    stubProjectsEnv();
    routeProjects([fullProject]);
    const { getProject } = await importProjects();

    expect(await getProject("no-such-project")).toBeNull();
  });

  it("returns null for an unpublished project reachable by direct id", async () => {
    stubProjectsEnv();
    routeProjects([
      fullProject,
      projectPage("project-draft", {
        title: titleProp("Draft build"),
        author: richTextProp("Someone"),
        body: richTextProp("Not reviewed yet."),
        published: checkboxProp(false),
      }),
    ]);
    const { getProject } = await importProjects();

    // Guessing the id of an unpublished submission must not surface it.
    expect(await getProject("project-draft")).toBeNull();
  });

  it("returns null when no Projects DB is configured", async () => {
    vi.stubEnv("NOTION_API_KEY", "");
    vi.stubEnv("NOTION_DB_PROJECTS", "");
    const { getProject } = await importProjects();

    expect(await getProject("project-1")).toBeNull();
  });
});

// ── getProjectsForTool (the "Built with this" join) ──────────────────

describe("getProjectsForTool", () => {
  it("returns only the projects that reference the tool", async () => {
    stubProjectsEnv();
    routeProjects([
      fullProject,
      projectPage("project-laser", {
        title: titleProp("Laser box"),
        author: richTextProp("Someone"),
        body: richTextProp("Body"),
        tools_used: relationProp(["tool-trotec-speedy-400"]),
        published: checkboxProp(true),
      }),
    ]);
    const { getProjectsForTool } = await importProjects();

    const forPrinter = await getProjectsForTool("tool-form-4");
    expect(forPrinter.map((project) => project.id)).toEqual(["project-1"]);
  });

  it("returns an empty array for a tool nothing was built with", async () => {
    stubProjectsEnv();
    routeProjects([fullProject]);
    const { getProjectsForTool } = await importProjects();

    expect(await getProjectsForTool("tool-trotec-speedy-400")).toEqual([]);
  });

  it("returns an empty array — never throws — for a deleted tool id", async () => {
    stubProjectsEnv();
    routeProjects([fullProject]);
    const { getProjectsForTool } = await importProjects();

    // A project referencing a deleted tool must not 500 the tool page.
    expect(await getProjectsForTool("tool-deleted")).toEqual([]);
  });

  it("returns an empty array when no Projects DB is configured", async () => {
    vi.stubEnv("NOTION_API_KEY", "");
    vi.stubEnv("NOTION_DB_PROJECTS", "");
    const { getProjectsForTool } = await importProjects();

    expect(await getProjectsForTool("tool-form-4")).toEqual([]);
  });
});
