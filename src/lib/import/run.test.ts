// @vitest-environment node
import { eq } from "drizzle-orm";
import { http, HttpResponse } from "msw";
import {
  categoriesPage,
  databaseSchema,
  flagsPage,
  locationsPage,
  maintenanceLogsPage,
  projectsPage,
  resourcesPage,
  toolsPage,
  unitsPage,
} from "../../../test/fixtures/notion";
import { server } from "../../../test/msw/server";
import { createPgliteDb } from "../db/pglite";
import { attachments, feedback, maintenanceLogs, projectTools, projects, tools, units } from "../db/schema/index";
import type { Db } from "../db/types";
import {
  pageToCategory,
  pageToFlag,
  pageToLocation,
  pageToMaintenanceLog,
  pageToProject,
  pageToResource,
  pageToTool,
  pageToUnit,
  readEmailProperty,
  type NotionPage,
} from "../notion";
import { createFileCopier, type BlobUploader } from "./files";
import { PreflightError } from "./preflight";
import { runImport } from "./run";
import type { NotionSnapshot } from "./source";

const asPage = (fixture: unknown) => fixture as NotionPage;

/** The fixtures as the reader would return them, with no Notion call. */
function fixtureSnapshot(): NotionSnapshot {
  const maintenance = asPage(maintenanceLogsPage);
  const flag = asPage(flagsPage);
  return {
    schemas: {
      units: databaseSchema("units"),
      maintenance_logs: databaseSchema("maintenance_logs"),
      flags: databaseSchema("flags"),
    },
    categories: [pageToCategory(asPage(categoriesPage))],
    locations: [pageToLocation(asPage(locationsPage))],
    tools: [pageToTool(asPage(toolsPage))],
    units: [pageToUnit(asPage(unitsPage))],
    resources: [pageToResource(asPage(resourcesPage))],
    maintenanceLogs: [
      { ...pageToMaintenanceLog(maintenance), reporterEmail: readEmailProperty(maintenance, ["reporter_email"]) || null },
    ],
    flags: [{ ...pageToFlag(flag), reporterEmail: readEmailProperty(flag, ["reporter_email"]) || null }],
    projects: [pageToProject(asPage(projectsPage))],
  };
}

function memoryUploader() {
  const stored: string[] = [];
  const uploader: BlobUploader = {
    async put(pathname) {
      stored.push(pathname);
      return { pathname: `${pathname}-r1`, url: `https://blob.test/${pathname}-r1` };
    },
  };
  return { uploader, stored };
}

/** Serve bytes for every file URL the fixtures reference (except the stale one). */
function serveFixtureFiles() {
  const bytes = () => HttpResponse.arrayBuffer(new Uint8Array([1, 2, 3]).buffer, { headers: { "content-type": "image/png" } });
  server.use(
    http.get("https://files.notion.so/*", bytes),
    http.get("https://example.com/*", bytes)
  );
}

describe("runImport", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createPgliteDb();
  });

  it("imports every entity in dependency order with relations resolved", async () => {
    const report = await runImport({ db, snapshot: fixtureSnapshot() });

    expect(report.counts).toEqual({
      categories: { inserted: 1, updated: 0 },
      locations: { inserted: 1, updated: 0 },
      tools: { inserted: 1, updated: 0 },
      units: { inserted: 1, updated: 0 },
      resources: { inserted: 1, updated: 0 },
      maintenance_logs: { inserted: 1, updated: 0 },
      feedback: { inserted: 1, updated: 0 },
      projects: { inserted: 1, updated: 0 },
    });
    expect(report.files).toEqual({ copied: 0, skipped: 0, failed: 0 });

    const [tool] = await db.select().from(tools);
    expect(tool).toMatchObject({ slug: "form-4", name: "Form 4", notionPageId: "tool-1", published: true });
    expect(tool.categoryId).not.toBeNull();
    expect(tool.locationId).not.toBeNull();

    const [unit] = await db.select().from(units);
    expect(unit.toolId).toBe(tool.id);
    expect(unit.status).toBe("available");

    const [ticket] = await db.select().from(maintenanceLogs);
    expect(ticket).toMatchObject({
      unitId: unit.id,
      toolId: tool.id,
      toolName: "Form 4",
      unitLabel: "Form 4 #1",
      status: "open",
      priority: "medium",
    });

    const [correction] = await db.select().from(feedback);
    expect(correction).toMatchObject({ toolId: tool.id, fieldFlagged: "description", reporterEmail: "ada@cornell.edu" });

    const [project] = await db.select().from(projects);
    expect(project).toMatchObject({ slug: "laser-cut-lamp", published: true });
    const links = await db.select().from(projectTools).where(eq(projectTools.projectId, project.id));
    expect(links).toEqual([{ projectId: project.id, toolId: tool.id }]);
  });

  it("copies files to Blob with the right access, skips dead URLs, and records attachments", async () => {
    serveFixtureFiles();
    const { uploader, stored } = memoryUploader();
    const report = await runImport({ db, snapshot: fixtureSnapshot(), files: createFileCopier(uploader) });

    // tool: 1 stale (skipped) + 1 fresh; resource: 2; maintenance: 1; project: 1
    expect(report.files).toEqual({ copied: 5, skipped: 1, failed: 0 });
    expect(report.warnings.some((w) => w.includes("dead file URL"))).toBe(true);
    expect(stored).toHaveLength(5);

    const rows = await db.select().from(attachments);
    const byOwner = Object.groupBy(rows, (row) => row.ownerType ?? "none");
    expect(byOwner.tool).toHaveLength(1);
    expect(byOwner.tool?.[0]).toMatchObject({ access: "public", position: 1, originalFilename: "fresh.png", sourceKey: "tool-1:image_attachments:1" });
    expect(byOwner.tool?.[0].publicUrl).toMatch(/^https:\/\/blob\.test\/tools\//);
    expect(byOwner.resource).toHaveLength(2);
    expect(byOwner.maintenance_log?.[0]).toMatchObject({ access: "private", publicUrl: null });
    expect(byOwner.project).toHaveLength(1);
  });

  it("is idempotent: a re-run updates rows, keeps slugs, and copies no file twice", async () => {
    serveFixtureFiles();
    const { uploader, stored } = memoryUploader();
    const copier = createFileCopier(uploader);
    await runImport({ db, snapshot: fixtureSnapshot(), files: copier });

    const renamed = fixtureSnapshot();
    renamed.tools[0].fields.name = "Form 4 (renamed)";
    const report = await runImport({ db, snapshot: renamed, files: copier });

    expect(report.counts.tools).toEqual({ inserted: 0, updated: 1 });
    expect(report.counts.units).toEqual({ inserted: 0, updated: 1 });
    expect(report.files).toEqual({ copied: 0, skipped: 6, failed: 0 });
    expect(stored).toHaveLength(5);

    const [tool] = await db.select().from(tools);
    expect(tool.name).toBe("Form 4 (renamed)");
    expect(tool.slug).toBe("form-4");
    expect(await db.select().from(attachments)).toHaveLength(5);
  });

  it("stops on a pre-flight problem and writes nothing", async () => {
    const snapshot = fixtureSnapshot();
    snapshot.schemas.units?.properties.status.select?.options.push({ name: "Broken" });
    await expect(runImport({ db, snapshot })).rejects.toBeInstanceOf(PreflightError);
    expect(await db.select().from(tools)).toHaveLength(0);
  });

  it("merges a category that appears twice in Notion and keeps both tools pointing at it", async () => {
    const snapshot = fixtureSnapshot();
    const twin = pageToCategory(asPage({ ...categoriesPage, id: "cat-2" }));
    snapshot.categories.push(twin);
    const secondTool = pageToTool(asPage({ ...toolsPage, id: "tool-2" }));
    secondTool.fields.category = ["cat-2"];
    snapshot.tools.push(secondTool);

    const report = await runImport({ db, snapshot });
    expect(report.counts.categories).toEqual({ inserted: 1, updated: 0 });
    expect(report.warnings.some((w) => w.includes("appears twice"))).toBe(true);
    const rows = await db.select({ categoryId: tools.categoryId }).from(tools);
    expect(new Set(rows.map((r) => r.categoryId)).size).toBe(1);
  });

  it("gives a second tool with the same name a suffixed slug", async () => {
    const snapshot = fixtureSnapshot();
    snapshot.tools.push(pageToTool(asPage({ ...toolsPage, id: "tool-2" })));
    await runImport({ db, snapshot });
    const rows = await db.select({ slug: tools.slug }).from(tools).orderBy(tools.slug);
    expect(rows.map((r) => r.slug)).toEqual(["form-4", "form-4-2"]);
  });

  it("records a failed download as a warning and keeps going", async () => {
    server.use(
      http.get("https://files.notion.so/*", () => new HttpResponse(null, { status: 403 })),
      http.get("https://example.com/*", () => HttpResponse.arrayBuffer(new Uint8Array([1]).buffer))
    );
    const { uploader } = memoryUploader();
    const report = await runImport({ db, snapshot: fixtureSnapshot(), files: createFileCopier(uploader) });
    expect(report.files.failed).toBeGreaterThan(0);
    expect(report.files.copied).toBeGreaterThan(0);
    expect(report.warnings.some((w) => w.includes("could not copy"))).toBe(true);
  });
});
