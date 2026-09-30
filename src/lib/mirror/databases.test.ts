// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { server } from "../../../test/msw/server";
// Aliased: the name starts with `use`, which eslint's rules-of-hooks reads as a React hook.
import { useNotionFake as installNotionFake } from "../../../test/msw/notion-mirror";
import { createNotionFake, type NotionFake } from "../../../test/fakes/notion-fake";
import { createPgliteDb } from "../db/pglite";
import { mirrorPages, notionMirrors, user } from "../db/schema/index";
import { MIRROR_ENTITY, type MirrorEntity } from "../db/schema/vocabulary";
import type { Db } from "../db/types";
import { upsertMirrorPage } from "../data/mirror-pages";
import { getMirror, saveMirrorConnection } from "../data/mirrors";
import { applyPastedMapping, ensureMirrorDatabases } from "./databases";
import { mirrorDatabaseTitle } from "./database-schemas";
import { encryptMirrorToken } from "./token-crypto";

/** Create databases and pasted mappings against the fake Notion (spec §3.8, §5.8). */

const TOKEN = "ntn_DATABASEStoken0123456789abcdef";
const SECRET = "test-auth-secret-for-mirror-databases";
const PARENT = "0f5e4a3c-1111-2222-3333-44445555aaaa";
const CLIENT = { requestsPerSecond: 0 };

let db: Db;
let fake: NotionFake;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", SECRET);
  fake = createNotionFake({ token: TOKEN, pages: [{ id: PARENT, title: "MakerLab Tools — mirror" }] });
  installNotionFake(server, fake);
});

async function connect(token = TOKEN, parent = PARENT): Promise<string> {
  const owner = `u-${crypto.randomUUID()}`;
  await db.insert(user).values({ id: owner, name: "Owner", email: `${owner}@cornell.edu`, role: "admin" });
  const { mirror } = await saveMirrorConnection(
    { ownerUserId: owner, tokenCiphertext: encryptMirrorToken(token, SECRET), parentPageId: parent, parentPageTitle: "Mirror" },
    { db }
  );
  return mirror.id;
}

function titleOf(body: unknown): string {
  return ((body as { title?: { text?: { content?: string } }[] }).title ?? [])[0]?.text?.content ?? "";
}

async function pagesFor(mirrorId: string, entity: MirrorEntity): Promise<number> {
  const rows = await db
    .select({ id: mirrorPages.entityId })
    .from(mirrorPages)
    .where(and(eq(mirrorPages.mirrorId, mirrorId), eq(mirrorPages.entity, entity)));
  return rows.length;
}

describe("ensureMirrorDatabases", () => {
  it("creates all seven under the page, in dependency order, with relations resolved", async () => {
    const mirrorId = await connect();
    const result = await ensureMirrorDatabases(mirrorId, { db, client: CLIENT });
    if (!result.ok) throw new Error(`expected ok, got ${result.code}`);

    expect(result.created).toEqual([...MIRROR_ENTITY]);
    expect(result.kept).toEqual([]);
    const creates = fake.requests.filter((request) => request.method === "POST" && request.path === "/databases");
    expect(creates.map((request) => titleOf(request.body))).toEqual(MIRROR_ENTITY.map(mirrorDatabaseTitle));

    const mapping = result.mapping;
    expect(Object.keys(mapping)).toEqual([...MIRROR_ENTITY]);
    const toolsDb = fake.databases.get(mapping.tools!)!;
    expect(toolsDb.parent).toEqual({ type: "page_id", page_id: PARENT });
    expect(toolsDb.properties.Category.relation).toMatchObject({ database_id: mapping.categories });
    expect(toolsDb.properties.Location.relation).toMatchObject({ database_id: mapping.locations });
    expect(fake.databases.get(mapping.maintenance!)!.properties.Unit.relation).toMatchObject({ database_id: mapping.units });
    expect(fake.databases.get(mapping.projects!)!.properties.Tools.relation).toMatchObject({ database_id: mapping.tools });

    expect((await getMirror(mirrorId, { db }))!.mapping).toEqual(mapping);
  });

  it("keeps every database on a second call and creates nothing", async () => {
    const mirrorId = await connect();
    const first = await ensureMirrorDatabases(mirrorId, { db, client: CLIENT });
    fake.requests.length = 0;
    const second = await ensureMirrorDatabases(mirrorId, { db, client: CLIENT });
    expect(second).toEqual({ ok: true, created: [], kept: [...MIRROR_ENTITY], mapping: first.ok ? first.mapping : null });
    expect(fake.requests.filter((request) => request.method !== "GET")).toEqual([]);
  });

  it("recreates a deleted database alone, resets its pages, and repoints its dependents", async () => {
    const mirrorId = await connect();
    const first = await ensureMirrorDatabases(mirrorId, { db, client: CLIENT });
    if (!first.ok) throw new Error("setup failed");
    const oldTools = first.mapping.tools!;
    await upsertMirrorPage({ mirrorId, entity: "tools", entityId: crypto.randomUUID(), notionPageId: "old-tool-page", sourceUpdatedAt: null }, { db });
    await upsertMirrorPage({ mirrorId, entity: "units", entityId: crypto.randomUUID(), notionPageId: "unit-page", sourceUpdatedAt: null }, { db });
    await db.update(notionMirrors).set({ lastSyncedAt: new Date() }).where(eq(notionMirrors.id, mirrorId));

    fake.databases.delete(oldTools);
    fake.requests.length = 0;
    const second = await ensureMirrorDatabases(mirrorId, { db, client: CLIENT });
    if (!second.ok) throw new Error(`expected ok, got ${second.code}`);

    expect(second.created).toEqual(["tools"]);
    expect(second.kept).toEqual(["categories", "locations", "units", "resources", "maintenance", "projects"]);
    const newTools = second.mapping.tools!;
    expect(newTools).not.toBe(oldTools);
    expect(await pagesFor(mirrorId, "tools")).toBe(0);
    expect(await pagesFor(mirrorId, "units")).toBe(1);
    expect((await getMirror(mirrorId, { db }))!.lastSyncedAt).toBeNull();

    // Every database with a relation to tools now points at the new one.
    const patched = fake.requests.filter((request) => request.method === "PATCH").map((request) => request.path);
    expect(patched.sort()).toEqual(
      [second.mapping.units, second.mapping.resources, second.mapping.maintenance, second.mapping.projects].map((id) => `/databases/${id}`).sort()
    );
    for (const entity of ["units", "resources", "maintenance"] as const) {
      expect(fake.databases.get(second.mapping[entity]!)!.properties.Tool.relation).toMatchObject({ database_id: newTools });
    }
    expect(fake.databases.get(second.mapping.projects!)!.properties.Tools.relation).toMatchObject({ database_id: newTools });
  });

  it("recreates a trashed database", async () => {
    const mirrorId = await connect();
    const first = await ensureMirrorDatabases(mirrorId, { db, client: CLIENT });
    if (!first.ok) throw new Error("setup failed");
    const categories = fake.databases.get(first.mapping.categories!)!;
    categories.archived = true;
    categories.in_trash = true;

    const second = await ensureMirrorDatabases(mirrorId, { db, client: CLIENT });
    if (!second.ok) throw new Error(`expected ok, got ${second.code}`);
    expect(second.created).toEqual(["categories"]);
    expect(fake.databases.get(second.mapping.tools!)!.properties.Category.relation).toMatchObject({
      database_id: second.mapping.categories,
    });
  });

  it("saves a partial mapping when Notion fails half way, then finishes on the next press", async () => {
    const mirrorId = await connect();
    // Categories and locations are created; the third create (tools) hits a 503.
    let creates = 0;
    const original = fake.handle;
    fake.handle = (method, path, headers, body) => {
      if (method === "POST" && path.endsWith("/databases") && ++creates === 3) {
        return { status: 503, headers: { "Content-Type": "application/json" }, body: { object: "error", status: 503, code: "service_unavailable", message: "Down." } };
      }
      return original(method, path, headers, body);
    };

    const partial = await ensureMirrorDatabases(mirrorId, { db, client: CLIENT });
    expect(partial).toEqual({ ok: false, code: "notion_unavailable", created: ["categories", "locations"], entity: "tools" });
    expect(Object.keys((await getMirror(mirrorId, { db }))!.mapping)).toEqual(["categories", "locations"]);

    const rest = await ensureMirrorDatabases(mirrorId, { db, client: CLIENT });
    if (!rest.ok) throw new Error(`expected ok, got ${rest.code}`);
    expect(rest.kept).toEqual(["categories", "locations"]);
    expect(rest.created).toEqual(["tools", "units", "resources", "maintenance", "projects"]);
  });

  it("says unauthorized on a 401, page_not_found for an unshared page, and needs a connection", async () => {
    const revoked = await connect("ntn_revokedTOKEN");
    expect(await ensureMirrorDatabases(revoked, { db, client: CLIENT })).toEqual({
      ok: false,
      code: "unauthorized",
      created: [],
      entity: "categories",
    });

    const unshared = await connect(TOKEN, "0f5e4a3c-9999-2222-3333-44445555aaaa");
    expect(await ensureMirrorDatabases(unshared, { db, client: CLIENT })).toMatchObject({ ok: false, code: "page_not_found" });

    expect(await ensureMirrorDatabases(crypto.randomUUID(), { db, client: CLIENT })).toMatchObject({ ok: false, code: "not_connected" });

    vi.stubEnv("AUTH_SECRET", "");
    expect(await ensureMirrorDatabases(unshared, { db, client: CLIENT })).toMatchObject({ ok: false, code: "key_unavailable" });
  });
});

describe("applyPastedMapping", () => {
  async function databasesFromAnotherMirror() {
    const source = await connect();
    const result = await ensureMirrorDatabases(source, { db, client: CLIENT });
    if (!result.ok) throw new Error("setup failed");
    return result.mapping;
  }

  it("persists pasted ids that validate — URLs and bare ids alike — and resets changed entities", async () => {
    const existing = await databasesFromAnotherMirror();
    const mirrorId = await connect();
    await upsertMirrorPage({ mirrorId, entity: "tools", entityId: crypto.randomUUID(), notionPageId: "stale", sourceUpdatedAt: null }, { db });

    const pasted = {
      categories: existing.categories!.replace(/-/g, ""),
      locations: `https://www.notion.so/workspace/Locations-${existing.locations!.replace(/-/g, "")}?v=abc`,
      tools: existing.tools!,
    };
    const result = await applyPastedMapping(mirrorId, pasted, { db, client: CLIENT });
    expect(result).toEqual({
      ok: true,
      mapping: { categories: existing.categories, locations: existing.locations, tools: existing.tools },
    });
    expect((await getMirror(mirrorId, { db }))!.mapping).toEqual(result.ok ? result.mapping : null);
    expect(await pagesFor(mirrorId, "tools")).toBe(0);
  });

  it("persists nothing when any pasted database does not match", async () => {
    const existing = await databasesFromAnotherMirror();
    const mirrorId = await connect();
    delete fake.databases.get(existing.tools!)!.properties["Emergency stop"];
    fake.databases.get(existing.tools!)!.properties.Published.type = "rich_text";

    const result = await applyPastedMapping(
      mirrorId,
      { categories: existing.categories!, tools: existing.tools!, units: "not an id", resources: crypto.randomUUID() },
      { db, client: CLIENT }
    );
    // An unreadable id is refused before Notion is asked anything.
    expect(result).toEqual({ ok: false, code: "invalid_database_id", problems: [{ entity: "units", code: "invalid_database_id" }] });

    const second = await applyPastedMapping(
      mirrorId,
      { categories: existing.categories!, tools: existing.tools!, resources: crypto.randomUUID() },
      { db, client: CLIENT }
    );
    expect(second).toEqual({
      ok: false,
      code: "schema_mismatch",
      problems: [
        { entity: "tools", code: "schema_mismatch", missing: ["Emergency stop"], wrongType: ["Published"] },
        { entity: "resources", code: "database_not_found" },
      ],
    });
    expect((await getMirror(mirrorId, { db }))!.mapping).toEqual({});
  });

  it("checks a pasted relation against the database its target maps to", async () => {
    const existing = await databasesFromAnotherMirror();
    const other = await databasesFromAnotherMirror();
    const mirrorId = await connect();
    const result = await applyPastedMapping(mirrorId, { categories: other.categories!, tools: existing.tools! }, { db, client: CLIENT });
    expect(result).toMatchObject({ ok: false, code: "schema_mismatch", problems: [{ entity: "tools", wrongType: ["Category"] }] });
  });

  it("says unauthorized on a 401", async () => {
    const existing = await databasesFromAnotherMirror();
    const mirrorId = await connect("ntn_revokedTOKEN");
    expect(await applyPastedMapping(mirrorId, { tools: existing.tools! }, { db, client: CLIENT })).toEqual({
      ok: false,
      code: "unauthorized",
      problems: [],
    });
  });
});
