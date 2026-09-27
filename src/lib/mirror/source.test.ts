// @vitest-environment node
import { eq, sql } from "drizzle-orm";
import { createPgliteDb } from "../db/pglite";
import { rawRows } from "../db/raw";
import {
  attachments,
  categories,
  maintenanceLogs,
  projectTools,
  projects,
  tools,
  units,
  user,
} from "../db/schema/index";
import type { MirrorEntity } from "../db/schema/vocabulary";
import type { Db } from "../db/types";
import { upsertMirrorPage } from "../data/mirror-pages";
import { saveMirrorConnection } from "../data/mirrors";
import { listSourceRows } from "./source";

/**
 * What a push selects (spec §3.8 "What is mirrored", 2026-09-23 amendment),
 * against PGlite. Each test gets its own database so row counts are exact.
 */

const MICROSECOND_STAMP = "2026-01-01 10:00:00.123456+00";

async function setup(): Promise<{ db: Db; mirrorId: string }> {
  const db = await createPgliteDb();
  const owner = `u-${crypto.randomUUID()}`;
  await db.insert(user).values({ id: owner, name: "Owner", email: `${owner}@cornell.edu`, role: "admin" });
  const { mirror } = await saveMirrorConnection(
    { ownerUserId: owner, tokenCiphertext: new Uint8Array([1, 2, 3]), parentPageId: crypto.randomUUID(), parentPageTitle: null },
    { db }
  );
  return { db, mirrorId: mirror.id };
}

async function insertTool(db: Db, values: Partial<typeof tools.$inferInsert> = {}): Promise<string> {
  const [row] = await db
    .insert(tools)
    .values({ slug: `t-${crypto.randomUUID()}`, name: "Form 4", ...values })
    .returning({ id: tools.id });
  return row.id;
}

async function all<E extends MirrorEntity>(db: Db, mirrorId: string, entity: E, since: string | null = null) {
  return listSourceRows(entity, { db, mirrorId, since, limit: 500 });
}

describe("mirror source rows", () => {
  it("includes drafts, and an archived tool only when it has a page to archive", async () => {
    const { db, mirrorId } = await setup();
    const published = await insertTool(db, { published: true });
    const draft = await insertTool(db, { published: false });
    const archivedUnmirrored = await insertTool(db, { published: true, archivedAt: new Date() });
    const archivedMirrored = await insertTool(db, { published: true, archivedAt: new Date() });
    await upsertMirrorPage(
      { mirrorId, entity: "tools", entityId: archivedMirrored, notionPageId: "page-archived", sourceUpdatedAt: null },
      { db }
    );

    const rows = await all(db, mirrorId, "tools");
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(published)).toMatchObject({ published: true, archive: false, pageId: null });
    expect(byId.get(draft)).toMatchObject({ published: false, archive: false });
    expect(byId.has(archivedUnmirrored)).toBe(false);
    expect(byId.get(archivedMirrored)).toMatchObject({ archive: true, archived: true, pageId: "page-archived" });
  });

  it("selects only public attachments with a URL, in position order — never a private maintenance photo", async () => {
    const { db, mirrorId } = await setup();
    const tool = await insertTool(db);
    const [log] = await db
      .insert(maintenanceLogs)
      .values({ title: "Leak", toolId: tool, reportedByName: "Ada", reportedByEmail: "ada@cornell.edu" })
      .returning({ id: maintenanceLogs.id });
    await db.insert(attachments).values([
      { ownerType: "tool", ownerId: tool, position: 1, blobPathname: "tools/second.jpg", access: "public", publicUrl: "https://blob.example/second.jpg" },
      { ownerType: "tool", ownerId: tool, position: 0, blobPathname: "tools/first.jpg", access: "public", publicUrl: "https://blob.example/first.jpg", originalFilename: "first.jpg" },
      { ownerType: "tool", ownerId: tool, position: 2, blobPathname: "tools/private.jpg", access: "private", publicUrl: "https://blob.example/tool-private.jpg" },
      { ownerType: "tool", ownerId: tool, position: 3, blobPathname: "tools/no-url.jpg", access: "public", publicUrl: null },
      { ownerType: "maintenance_log", ownerId: log.id, position: 0, blobPathname: "maintenance/PRIVATE-PHOTO.jpg", access: "private", publicUrl: null },
      // Even a maintenance photo that somehow had a public URL is never read.
      { ownerType: "maintenance_log", ownerId: log.id, position: 1, blobPathname: "maintenance/odd.jpg", access: "public", publicUrl: "https://blob.example/MAINTENANCE-PHOTO.jpg" },
    ]);

    const [toolRow] = await all(db, mirrorId, "tools");
    expect(toolRow.images).toEqual([
      { url: "https://blob.example/first.jpg", name: "first.jpg" },
      { url: "https://blob.example/second.jpg", name: null },
    ]);

    const everything = JSON.stringify(
      await Promise.all(
        (["categories", "locations", "tools", "units", "resources", "maintenance", "projects"] as const).map((entity) =>
          all(db, mirrorId, entity)
        )
      )
    );
    expect(everything).not.toContain("PRIVATE-PHOTO");
    expect(everything).not.toContain("MAINTENANCE-PHOTO");
    expect(everything).not.toContain("tool-private");
  });

  it("carries the maintenance reporter's and assignee's names and emails", async () => {
    const { db, mirrorId } = await setup();
    await db.insert(user).values({ id: "assignee-1", name: "Niti", email: "niti@cornell.edu" });
    const tool = await insertTool(db);
    await db.insert(maintenanceLogs).values({
      title: "Leak",
      toolId: tool,
      reportedByName: "Ada",
      reportedByEmail: "ada@cornell.edu",
      assignedToUserId: "assignee-1",
      assignedToName: "Niti",
      dateReported: "2026-02-01",
    });
    const [row] = await all(db, mirrorId, "maintenance");
    expect(row).toMatchObject({
      reportedByName: "Ada",
      reportedByEmail: "ada@cornell.edu",
      assignedToName: "Niti",
      assigneeEmail: "niti@cornell.edu",
      toolId: tool,
      dateReported: "2026-02-01",
    });
  });

  it("excludes unpublished projects unless already mirrored, carries the author's email, and leaves archived tools out", async () => {
    const { db, mirrorId } = await setup();
    await db.insert(user).values({ id: "author-1", name: "Luis", email: "luis@cornell.edu" });
    const liveTool = await insertTool(db);
    const archivedTool = await insertTool(db, { archivedAt: new Date() });
    const [live, waiting, withdrawn] = await db
      .insert(projects)
      .values([
        { slug: "live", title: "Live", published: true, authorUserId: "author-1", authorName: "Luis" },
        { slug: "waiting", title: "Waiting", published: false },
        { slug: "withdrawn", title: "Withdrawn", published: false },
      ])
      .returning({ id: projects.id });
    await db.insert(projectTools).values([
      { projectId: live.id, toolId: liveTool },
      { projectId: live.id, toolId: archivedTool },
    ]);
    await upsertMirrorPage({ mirrorId, entity: "projects", entityId: withdrawn.id, notionPageId: "page-w", sourceUpdatedAt: null }, { db });

    const rows = await all(db, mirrorId, "projects");
    const ids = rows.map((row) => row.id);
    expect(ids).toContain(live.id);
    expect(ids).not.toContain(waiting.id);
    expect(rows.find((row) => row.id === withdrawn.id)).toMatchObject({ archive: true, pageId: "page-w" });
    expect(rows.find((row) => row.id === live.id)).toMatchObject({
      archive: false,
      authorName: "Luis",
      authorEmail: "luis@cornell.edu",
      toolIds: [liveTool],
    });
  });

  it("drops the relation to an archived tool from units", async () => {
    const { db, mirrorId } = await setup();
    const archivedTool = await insertTool(db, { archivedAt: new Date() });
    const liveTool = await insertTool(db);
    await db.insert(units).values([
      { toolId: archivedTool, unitLabel: "Old #1" },
      { toolId: liveTool, unitLabel: "New #1" },
    ]);
    const rows = await all(db, mirrorId, "units");
    expect(Object.fromEntries(rows.map((row) => [row.unitLabel, row.toolId]))).toEqual({ "Old #1": null, "New #1": liveTool });
  });

  it("keeps the revision's microseconds", async () => {
    const { db, mirrorId } = await setup();
    const id = await insertTool(db);
    await db.execute(sql`alter table tools disable trigger tools_set_updated_at`);
    await db.execute(sql`update tools set updated_at = ${sql.raw(`timestamptz '${MICROSECOND_STAMP}'`)} where id = ${id}`);
    await db.execute(sql`alter table tools enable trigger tools_set_updated_at`);

    const [row] = await all(db, mirrorId, "tools");
    expect(row.revision).toMatch(/\.123456/);
    const [check] = await rawRows<{ same: boolean }>(
      db,
      sql`select (${row.revision}::timestamptz = ${sql.raw(`timestamptz '${MICROSECOND_STAMP}'`)}) as same`
    );
    expect(check.same).toBe(true);

    // Written back verbatim, the row is current: nothing is selected.
    await upsertMirrorPage({ mirrorId, entity: "tools", entityId: id, notionPageId: "p", sourceUpdatedAt: row.revision }, { db });
    expect(await all(db, mirrorId, "tools")).toEqual([]);
  });

  it("skips rows already mirrored at their revision, and selects them again when they change", async () => {
    const { db, mirrorId } = await setup();
    const [a, b] = await db
      .insert(categories)
      .values([{ name: "A" }, { name: "B" }])
      .returning({ id: categories.id });
    const first = await all(db, mirrorId, "categories");
    expect(first.map((row) => row.name).sort()).toEqual(["A", "B"]);

    const rowA = first.find((row) => row.id === a.id)!;
    await upsertMirrorPage({ mirrorId, entity: "categories", entityId: a.id, notionPageId: "page-a", sourceUpdatedAt: rowA.revision }, { db });
    // A page recorded without a revision (a deferred row) is selected again.
    await upsertMirrorPage({ mirrorId, entity: "categories", entityId: b.id, notionPageId: "page-b", sourceUpdatedAt: null }, { db });
    const second = await all(db, mirrorId, "categories");
    expect(second.map((row) => [row.name, row.pageId])).toEqual([["B", "page-b"]]);

    await db.update(categories).set({ group: "Fabrication" }).where(eq(categories.id, a.id));
    const third = await all(db, mirrorId, "categories");
    expect(third.map((row) => row.name).sort()).toEqual(["A", "B"]);
    expect(third.find((row) => row.id === a.id)).toMatchObject({ group: "Fabrication", pageId: "page-a" });
  });

  it("honours since, and pages through with a keyset cursor", async () => {
    const { db, mirrorId } = await setup();
    await db.insert(categories).values([{ name: "A" }, { name: "B" }, { name: "C" }]);
    const [{ later }] = await rawRows<{ later: string }>(db, sql`select (now() + interval '1 minute')::text as later`);
    expect(await all(db, mirrorId, "categories", later)).toEqual([]);

    const page1 = await listSourceRows("categories", { db, mirrorId, since: null, limit: 2 });
    expect(page1).toHaveLength(2);
    const last = page1[1];
    const page2 = await listSourceRows("categories", { db, mirrorId, since: null, limit: 2, after: { revision: last.revision, id: last.id } });
    expect(page2).toHaveLength(1);
    expect(new Set([...page1, ...page2].map((row) => row.name))).toEqual(new Set(["A", "B", "C"]));
  });
});
