// @vitest-environment node
import { createPgliteDb } from "../db/pglite";
import { attachments, projectTools, projects, tools } from "../db/schema/index";
import type { Db } from "../db/types";

/**
 * `src/lib/data/projects.ts` calls `getDb()` internally, like every other
 * query module (spec §3.2 — one entry point, no `Proxy`, no db parameter to
 * plumb through pages). Tests therefore need `getDb()` itself to resolve to
 * an isolated, per-test PGlite instance rather than the memoised demo
 * database — done by mocking `../db/client.ts`, the exact specifier the
 * module under test imports, and pointing it at a fresh `createPgliteDb()`
 * before each test.
 */
const dbHolder = vi.hoisted(() => ({ current: undefined as Db | undefined }));

vi.mock("../db/client.ts", () => ({
  getDb: () => Promise.resolve(dbHolder.current),
}));

import { findPublishedProject, listPublishedProjects, listPublishedProjectsForTool } from "./projects";

async function insertProject(
  db: Db,
  overrides: Partial<typeof projects.$inferInsert> = {}
): Promise<string> {
  const [row] = await db
    .insert(projects)
    .values({
      slug: `project-${crypto.randomUUID()}`,
      title: "Untitled project",
      body: "Body",
      published: true,
      ...overrides,
    })
    .returning({ id: projects.id });
  return row.id;
}

async function insertTool(db: Db, overrides: Partial<typeof tools.$inferInsert> = {}): Promise<string> {
  const [row] = await db
    .insert(tools)
    .values({
      slug: `tool-${crypto.randomUUID()}`,
      name: "A tool",
      published: true,
      ...overrides,
    })
    .returning({ id: tools.id });
  return row.id;
}

async function linkTool(db: Db, projectId: string, toolId: string): Promise<void> {
  await db.insert(projectTools).values({ projectId, toolId });
}

async function addPhoto(
  db: Db,
  projectId: string,
  overrides: Partial<typeof attachments.$inferInsert> = {}
): Promise<void> {
  await db.insert(attachments).values({
    ownerType: "project",
    ownerId: projectId,
    blobPathname: `projects/${projectId}/${crypto.randomUUID()}.png`,
    access: "public",
    publicUrl: `https://blob.test/${crypto.randomUUID()}.png`,
    position: 0,
    ...overrides,
  });
}

describe("src/lib/data/projects.ts", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createPgliteDb();
    dbHolder.current = db;
  });

  describe("listPublishedProjects", () => {
    it("returns only published projects, newest first", async () => {
      await insertProject(db, {
        title: "Older",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      });
      await insertProject(db, { title: "Draft", published: false });
      await insertProject(db, {
        title: "Newer",
        createdAt: new Date("2026-02-01T00:00:00.000Z"),
      });

      const result = await listPublishedProjects();
      expect(result.map((project) => project.title)).toEqual(["Newer", "Older"]);
    });

    it("falls back to Anonymous when author_name is null, and reports the created_at ISO string", async () => {
      const createdAt = new Date("2026-03-04T12:30:00.000Z");
      await insertProject(db, { title: "No byline", authorName: null, createdAt });

      const [project] = await listPublishedProjects();
      expect(project.author).toBe("Anonymous");
      expect(project.date).toBe(createdAt.toISOString());
    });

    it("uses the author_name when present", async () => {
      await insertProject(db, { title: "With byline", authorName: "Ada Lovelace" });

      const [project] = await listPublishedProjects();
      expect(project.author).toBe("Ada Lovelace");
    });

    it("orders photos by position, and includes only public attachments owned by the project", async () => {
      const projectId = await insertProject(db, { title: "Gallery" });
      await addPhoto(db, projectId, { position: 1, publicUrl: "https://blob.test/second.png" });
      await addPhoto(db, projectId, { position: 0, publicUrl: "https://blob.test/first.png" });
      // A private photo (e.g. a re-owned maintenance shot) must never surface.
      await addPhoto(db, projectId, { position: 2, publicUrl: null, access: "private" });
      // A public attachment with no URL yet (upload recorded before the blob
      // finished) is skipped rather than rendered as a broken image.
      await addPhoto(db, projectId, { position: 3, publicUrl: null, access: "public" });

      const [project] = await listPublishedProjects();
      expect(project.photos).toEqual(["https://blob.test/first.png", "https://blob.test/second.png"]);
    });

    it("resolves tool refs to {id,name,slug}, and drops refs to unpublished tools without dropping the project", async () => {
      const projectId = await insertProject(db, { title: "Built with two" });
      const published = await insertTool(db, { name: "Form 4", slug: "form-4", published: true });
      const draft = await insertTool(db, { name: "Secret prototype", slug: "secret-prototype", published: false });
      await linkTool(db, projectId, published);
      await linkTool(db, projectId, draft);

      const [project] = await listPublishedProjects();
      expect(project.tools).toEqual([{ id: published, name: "Form 4", slug: "form-4" }]);
    });
  });

  describe("findPublishedProject", () => {
    it("finds a published project by its uuid id", async () => {
      const id = await insertProject(db, { title: "By id" });

      const project = await findPublishedProject(id);
      expect(project?.id).toBe(id);
      expect(project?.title).toBe("By id");
    });

    it("finds a published project by its slug", async () => {
      await insertProject(db, { title: "By slug", slug: "by-slug" });

      const project = await findPublishedProject("by-slug");
      expect(project?.title).toBe("By slug");
    });

    it("returns null for an unpublished project, whether looked up by id or by slug", async () => {
      const id = await insertProject(db, { title: "Draft", slug: "draft-project", published: false });

      expect(await findPublishedProject(id)).toBeNull();
      expect(await findPublishedProject("draft-project")).toBeNull();
    });

    it("returns null for an id that does not exist", async () => {
      expect(await findPublishedProject(crypto.randomUUID())).toBeNull();
    });

    it("returns null for a slug that does not exist", async () => {
      expect(await findPublishedProject("no-such-project")).toBeNull();
    });
  });

  describe("listPublishedProjectsForTool", () => {
    it("returns only published projects that reference the given tool", async () => {
      const toolId = await insertTool(db, { name: "Trotec Speedy 400" });
      const otherToolId = await insertTool(db, { name: "Form 4" });
      const built = await insertProject(db, { title: "Laser box" });
      const other = await insertProject(db, { title: "Printed part" });
      const draft = await insertProject(db, { title: "Draft laser project", published: false });
      await linkTool(db, built, toolId);
      await linkTool(db, other, otherToolId);
      await linkTool(db, draft, toolId);

      const result = await listPublishedProjectsForTool(toolId);
      expect(result.map((project) => project.title)).toEqual(["Laser box"]);
    });

    it("returns an empty array for a tool nothing was built with", async () => {
      const toolId = await insertTool(db);
      await insertProject(db, { title: "Unrelated" });

      expect(await listPublishedProjectsForTool(toolId)).toEqual([]);
    });

    it("returns an empty array instead of throwing when the id is not uuid-shaped", async () => {
      await expect(listPublishedProjectsForTool("not-a-uuid")).resolves.toEqual([]);
    });
  });
});
