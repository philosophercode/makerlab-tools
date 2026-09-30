// @vitest-environment node
import { eq, sql } from "drizzle-orm";
import { createPgliteDb } from "../db/pglite";
import { rawRows } from "../db/raw";
import { categories, maintenanceLogs, mirrorPages, notionMirrors, tools, user } from "../db/schema/index";
import type { Db } from "../db/types";
import {
  MIRROR_SOURCE_TABLE,
  deleteMirrorPage,
  getMirrorPageIds,
  listOrphanedMirrorPages,
  upsertMirrorPage,
} from "./mirror-pages";

describe("mirror_pages", () => {
  let db: Db;
  let mirrorId: string;
  let otherMirrorId: string;

  beforeAll(async () => {
    db = await createPgliteDb();
    const ids: string[] = [];
    for (const owner of ["u-pages-1", "u-pages-2"]) {
      await db.insert(user).values({ id: owner, name: "Owner", email: `${owner}@cornell.edu`, role: "admin" });
      const [row] = await db
        .insert(notionMirrors)
        .values({ ownerUserId: owner, parentPageId: "page" })
        .returning({ id: notionMirrors.id });
      ids.push(row.id);
    }
    [mirrorId, otherMirrorId] = ids;
  });

  it("records a page, finds it, and re-records it in place", async () => {
    const entityId = crypto.randomUUID();
    await upsertMirrorPage(
      { mirrorId, entity: "tools", entityId, notionPageId: "n-1", sourceUpdatedAt: "2026-09-23 10:00:00.123456+00" },
      { db }
    );
    await upsertMirrorPage(
      { mirrorId, entity: "tools", entityId, notionPageId: "n-2", sourceUpdatedAt: "2026-09-23 10:05:00.654321+00" },
      { db }
    );

    const found = await getMirrorPageIds(mirrorId, "tools", [entityId, crypto.randomUUID(), "not-a-uuid"], { db });
    expect(found).toEqual(new Map([[entityId, "n-2"]]));

    const [row] = await rawRows<{ source: string; n: number }>(
      db,
      sql`select (source_updated_at at time zone 'UTC')::text as source,
                 (select count(*)::int from mirror_pages where entity_id = ${entityId}) as n
            from mirror_pages where entity_id = ${entityId}`
    );
    // Written from text, so Postgres' microseconds survive (revision.ts).
    expect(row.source).toMatch(/10:05:00\.654321/);
    expect(Number(row.n)).toBe(1);
  });

  it("accepts a null source_updated_at", async () => {
    const entityId = crypto.randomUUID();
    await upsertMirrorPage({ mirrorId, entity: "units", entityId, notionPageId: "n-u", sourceUpdatedAt: null }, { db });
    const [row] = await db.select().from(mirrorPages).where(eq(mirrorPages.entityId, entityId));
    expect(row.sourceUpdatedAt).toBeNull();
    expect(row.pushedAt).toBeInstanceOf(Date);
  });

  it("keeps each mirror's and each entity's pages apart", async () => {
    const entityId = crypto.randomUUID();
    await upsertMirrorPage({ mirrorId, entity: "tools", entityId, notionPageId: "mine", sourceUpdatedAt: null }, { db });
    await upsertMirrorPage(
      { mirrorId: otherMirrorId, entity: "tools", entityId, notionPageId: "theirs", sourceUpdatedAt: null },
      { db }
    );
    expect((await getMirrorPageIds(mirrorId, "tools", [entityId], { db })).get(entityId)).toBe("mine");
    expect((await getMirrorPageIds(otherMirrorId, "tools", [entityId], { db })).get(entityId)).toBe("theirs");
    expect((await getMirrorPageIds(mirrorId, "units", [entityId], { db })).size).toBe(0);
    expect((await getMirrorPageIds(mirrorId, "tools", [], { db })).size).toBe(0);
  });

  it("forgets one page", async () => {
    const entityId = crypto.randomUUID();
    await upsertMirrorPage({ mirrorId, entity: "resources", entityId, notionPageId: "n-r", sourceUpdatedAt: null }, { db });
    await deleteMirrorPage(mirrorId, "resources", entityId, { db });
    expect((await getMirrorPageIds(mirrorId, "resources", [entityId], { db })).size).toBe(0);
  });

  it("maps maintenance to maintenance_logs", () => {
    expect(MIRROR_SOURCE_TABLE.maintenance).toBe("maintenance_logs");
  });

  it("lists pages whose source row is gone, per entity, oldest first and capped", async () => {
    const [kept] = await db
      .insert(tools)
      .values({ name: "Kept", slug: `kept-${crypto.randomUUID()}` })
      .returning({ id: tools.id });
    const goneA = crypto.randomUUID();
    const goneB = crypto.randomUUID();
    for (const [entityId, page, ago] of [
      [kept.id, "n-kept", 3],
      [goneA, "n-gone-a", 2],
      [goneB, "n-gone-b", 1],
    ] as const) {
      await upsertMirrorPage({ mirrorId, entity: "tools", entityId, notionPageId: page, sourceUpdatedAt: null }, { db });
      await db.execute(
        sql`update mirror_pages set pushed_at = now() - ${sql.raw(`interval '${ago + 100} minutes'`)} where entity_id = ${entityId}`
      );
    }

    const orphans = await listOrphanedMirrorPages(mirrorId, "tools", { limit: 10 }, { db });
    expect(orphans.filter((row) => row.notionPageId.startsWith("n-gone") || row.notionPageId === "n-kept")).toEqual([
      { entityId: goneA, notionPageId: "n-gone-a" },
      { entityId: goneB, notionPageId: "n-gone-b" },
    ]);
    expect(await listOrphanedMirrorPages(mirrorId, "tools", { limit: 1, db })).toEqual([
      { entityId: goneA, notionPageId: "n-gone-a" },
    ]);
  });

  it("anti-joins maintenance against maintenance_logs", async () => {
    const [category] = await db.insert(categories).values({ name: "C", group: "G" }).returning({ id: categories.id });
    const [log] = await db
      .insert(maintenanceLogs)
      .values({ title: "Nozzle clog", type: "issue_report", priority: "low", status: "open" })
      .returning({ id: maintenanceLogs.id });
    const gone = crypto.randomUUID();
    await upsertMirrorPage({ mirrorId: otherMirrorId, entity: "maintenance", entityId: log.id, notionPageId: "n-log", sourceUpdatedAt: null }, { db });
    await upsertMirrorPage({ mirrorId: otherMirrorId, entity: "maintenance", entityId: gone, notionPageId: "n-gone", sourceUpdatedAt: null }, { db });
    await upsertMirrorPage({ mirrorId: otherMirrorId, entity: "categories", entityId: category.id, notionPageId: "n-cat", sourceUpdatedAt: null }, { db });

    expect(await listOrphanedMirrorPages(otherMirrorId, "maintenance", {}, { db })).toEqual([
      { entityId: gone, notionPageId: "n-gone" },
    ]);
    expect(await listOrphanedMirrorPages(otherMirrorId, "categories", {}, { db })).toEqual([]);
  });
});
