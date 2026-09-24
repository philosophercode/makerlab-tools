// @vitest-environment node
import { eq } from "drizzle-orm";
import { createPgliteDb } from "../db/pglite";
import { attachments, projectTools, projects, tools } from "../db/schema/index";
import { insertUserRow } from "../../../test/utils/session";
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

import {
  createProjectSubmission,
  findPublishedProject,
  listPublishedProjects,
  listPublishedProjectsForTool,
} from "./projects";

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

  describe("createProjectSubmission", () => {
    /** An uploaded-but-unattached file, as `POST /api/uploads` will leave one. */
    async function upload(
      overrides: Partial<typeof attachments.$inferInsert> = {}
    ): Promise<string> {
      const [row] = await db
        .insert(attachments)
        .values({
          blobPathname: `uploads/${crypto.randomUUID()}.png`,
          access: "public",
          contentType: "image/png",
          ...overrides,
        })
        .returning({ id: attachments.id });
      return row.id;
    }

    async function storedProject(id: string) {
      const [row] = await db.select().from(projects).where(eq(projects.id, id));
      return row;
    }

    function submission(overrides: Record<string, unknown> = {}) {
      return {
        title: "Lamp from scrap plywood",
        body: "Cut on the laser, glued, sanded.",
        authorName: "Ada Lovelace",
        ...overrides,
      };
    }

    it("writes one unpublished row that the gallery cannot see", async () => {
      const created = await createProjectSubmission(submission(), { db });

      const row = await storedProject(created.id);
      // Article 5: a submission is a draft, full stop. There is no argument
      // this function takes that could make it otherwise.
      expect(row.published).toBe(false);
      expect(row.publishedAt).toBeNull();
      expect(row.title).toBe("Lamp from scrap plywood");
      expect(await listPublishedProjects()).toEqual([]);
      expect(await findPublishedProject(created.slug)).toBeNull();
    });

    it("derives the slug from the title and suffixes a collision", async () => {
      const first = await createProjectSubmission(submission(), { db });
      const second = await createProjectSubmission(submission(), { db });
      const third = await createProjectSubmission(submission(), { db });

      expect(first.slug).toBe("lamp-from-scrap-plywood");
      expect(second.slug).toBe("lamp-from-scrap-plywood-2");
      expect(third.slug).toBe("lamp-from-scrap-plywood-3");
    });

    it("does not collide with a slug that merely starts the same way", async () => {
      await insertProject(db, { title: "Lamp", slug: "lamp" });

      const created = await createProjectSubmission(submission({ title: "Lamp stand" }), { db });
      expect(created.slug).toBe("lamp-stand");
    });

    it("links only the tool ids that name a real tool", async () => {
      const real = await insertTool(db, { name: "Form 4", slug: "form-4" });
      const stale = crypto.randomUUID();

      const created = await createProjectSubmission(
        submission({ toolIds: [real, stale, "not-a-uuid"] }),
        { db }
      );

      // A stale id in a form that has been open a while drops out rather than
      // costing the student their write-up (Article 4).
      expect(created.toolsLinked).toBe(1);
      const links = await db
        .select()
        .from(projectTools)
        .where(eq(projectTools.projectId, created.id));
      expect(links.map((link) => link.toolId)).toEqual([real]);
    });

    it("claims the photos onto the project, cover first", async () => {
      const cover = await upload();
      const second = await upload();

      const created = await createProjectSubmission(
        submission({ photoAttachmentIds: [cover, second] }),
        { db }
      );

      expect(created.photosAttached).toBe(2);
      const rows = await db
        .select()
        .from(attachments)
        .where(eq(attachments.ownerId, created.id))
        .orderBy(attachments.position);
      expect(rows.map((row) => row.id)).toEqual([cover, second]);
      expect(rows.every((row) => row.ownerType === "project")).toBe(true);
    });

    it("records the author id from the session, and nothing when anonymous", async () => {
      // Since Phase 4 `created_by` references `user.id`, so the author has to
      // be a row — which in production they are, because the id comes from a
      // session.
      await insertUserRow(db, { id: "google-sub-1", email: "ada@cornell.edu" });
      const signedIn = await createProjectSubmission(
        submission({ authorUserId: "google-sub-1" }),
        { db }
      );
      const anonymous = await createProjectSubmission(submission(), { db });

      expect(await storedProject(signedIn.id)).toMatchObject({
        authorUserId: "google-sub-1",
        createdBy: "google-sub-1",
        authorName: "Ada Lovelace",
      });
      // Anonymous submission stays a first-class path at the data layer; the
      // sign-in requirement is enforced at the route, not here.
      const row = await storedProject(anonymous.id);
      expect(row.authorUserId).toBeNull();
      expect(row.createdBy).toBeNull();
    });

    it("stores materials and the link, and normalises an absent link to null", async () => {
      const withLink = await createProjectSubmission(
        submission({ materials: ["Plywood", "Glue"], link: "https://example.com/lamp" }),
        { db }
      );
      const without = await createProjectSubmission(submission({ title: "No link" }), { db });

      expect(await storedProject(withLink.id)).toMatchObject({
        materials: ["Plywood", "Glue"],
        link: "https://example.com/lamp",
      });
      const bare = await storedProject(without.id);
      expect(bare.link).toBeNull();
      expect(bare.materials).toEqual([]);
    });

    it("becomes visible the moment somebody publishes it, with its photos and tools intact", async () => {
      const toolId = await insertTool(db, { name: "Trotec Speedy 400", slug: "trotec" });
      const cover = await upload({ publicUrl: "https://blob.test/cover.png" });
      const created = await createProjectSubmission(
        submission({ toolIds: [toolId], photoAttachmentIds: [cover] }),
        { db }
      );

      await db.update(projects).set({ published: true }).where(eq(projects.id, created.id));

      const [project] = await listPublishedProjects();
      expect(project.title).toBe("Lamp from scrap plywood");
      expect(project.photos).toEqual(["https://blob.test/cover.png"]);
      expect(project.tools).toEqual([
        { id: toolId, name: "Trotec Speedy 400", slug: "trotec" },
      ]);
    });

    it("retries once against the current slug set when the unique index refuses one", async () => {
      // PGlite is a single connection, so a genuine race cannot be staged. The
      // handle stands in for the loser of one: the first transaction comes back
      // as SQLSTATE 23505 (what Postgres answers when somebody else took the
      // slug between the read and the insert), and the second runs for real.
      let refused = false;
      const flaky: Db = Object.create(db);
      flaky.transaction = ((callback: Parameters<Db["transaction"]>[0]) => {
        if (refused) return db.transaction(callback);
        refused = true;
        return Promise.reject(Object.assign(new Error("duplicate key"), { code: "23505" }));
      }) as Db["transaction"];

      const created = await createProjectSubmission(submission(), { db: flaky });

      expect(refused).toBe(true);
      expect(created.slug).toBe("lamp-from-scrap-plywood");
      expect((await storedProject(created.id)).published).toBe(false);
    });

    it("gives up on a failure that is not a slug collision, leaving nothing behind", async () => {
      const boom: Db = Object.create(db);
      let attempts = 0;
      boom.transaction = (() => {
        attempts += 1;
        return Promise.reject(new Error("connection terminated"));
      }) as Db["transaction"];

      await expect(createProjectSubmission(submission(), { db: boom })).rejects.toThrow(
        /connection terminated/
      );
      // One attempt, not two: only a collision is worth retrying, and a caller
      // told the write failed must be told the truth (Article 4).
      expect(attempts).toBe(1);
      expect(await db.select().from(projects)).toEqual([]);
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
