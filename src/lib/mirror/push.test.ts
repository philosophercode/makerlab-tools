// @vitest-environment node
import { eq, sql } from "drizzle-orm";
import { server } from "../../../test/msw/server";
// Aliased: the name starts with `use`, which eslint's rules-of-hooks reads as a React hook.
import { useNotionFake as installNotionFake } from "../../../test/msw/notion-mirror";
import { createNotionFake, type NotionFake, type NotionFakeResponse } from "../../../test/fakes/notion-fake";
import { seedDemo } from "../db/demo-seed";
import { createPgliteDb } from "../db/pglite";
import { rawRows } from "../db/raw";
import { categories, maintenanceLogs, mirrorPages, notionMirrors, projects, tools, units, user } from "../db/schema/index";
import { MIRROR_ENTITY, type MirrorEntity } from "../db/schema/vocabulary";
import type { Db } from "../db/types";
import { getMirror, resetMirrorEntities, saveMirrorConnection, setMirrorPaused } from "../data/mirrors";
import { ensureMirrorDatabases } from "./databases";
import { pushMirror, type MirrorPushOutcome } from "./push";
import { encryptMirrorToken } from "./token-crypto";
import type { MirrorMapping } from "./types";

/**
 * The push against the fake Notion (spec §10 "Mirror against mocked Notion",
 * §3.8, §5.8). Every test gets its own seeded PGlite and its own fake, and
 * drives the client with a fake clock: `sleep` advances it, so the throttle,
 * `Retry-After` and the budget are all exact and instant.
 */

const TOKEN = "ntn_PUSHtoken0123456789abcdefSECRET";
const SECRET = "test-auth-secret-for-mirror-push";
const PARENT = "0f5e4a3c-1111-2222-3333-44445555aaaa";

interface Harness {
  db: Db;
  fake: NotionFake;
  mirrorId: string;
  ownerId: string;
  mapping: MirrorMapping;
  clock: { t: number };
  sleep: ReturnType<typeof vi.fn<(ms: number) => Promise<void>>>;
  push: (options?: { budgetMs?: number; requestsPerSecond?: number }) => Promise<MirrorPushOutcome>;
}

async function harness(options: { databases?: boolean } = {}): Promise<Harness> {
  vi.stubEnv("AUTH_SECRET", SECRET);
  const db = await createPgliteDb({ seed: seedDemo });
  const fake = createNotionFake({ token: TOKEN, pages: [{ id: PARENT, title: "MakerLab Tools — mirror" }] });
  installNotionFake(server, fake);

  const ownerId = `owner-${crypto.randomUUID()}`;
  await db.insert(user).values({ id: ownerId, name: "Mirror Owner", email: `${ownerId}@cornell.edu`, role: "admin" });
  const { mirror } = await saveMirrorConnection(
    { ownerUserId: ownerId, tokenCiphertext: encryptMirrorToken(TOKEN, SECRET), parentPageId: PARENT, parentPageTitle: "Mirror" },
    { db }
  );

  const clock = { t: 1_700_000_000_000 };
  const sleep = vi.fn(async (ms: number) => {
    clock.t += ms;
  });
  const client = (requestsPerSecond = 0) => ({ requestsPerSecond, now: () => clock.t, sleep });

  let mapping: MirrorMapping = {};
  if (options.databases !== false) {
    const ensured = await ensureMirrorDatabases(mirror.id, { db, client: client() });
    if (!ensured.ok) throw new Error(`setup failed: ${ensured.code}`);
    mapping = ensured.mapping;
    fake.requests.length = 0;
  }

  return {
    db,
    fake,
    mirrorId: mirror.id,
    ownerId,
    mapping,
    clock,
    sleep,
    push: (opts = {}) =>
      pushMirror(mirror.id, { db, budgetMs: opts.budgetMs, client: client(opts.requestsPerSecond ?? 0) }),
  };
}

/** How many rows each entity should mirror, counted by SQL. */
async function expectedCounts(db: Db): Promise<Record<MirrorEntity, number>> {
  const [row] = await rawRows<Record<MirrorEntity, number | string>>(
    db,
    sql`select
      (select count(*) from categories) as categories,
      (select count(*) from locations) as locations,
      (select count(*) from tools where archived_at is null) as tools,
      (select count(*) from units) as units,
      (select count(*) from resources) as resources,
      (select count(*) from maintenance_logs) as maintenance,
      (select count(*) from projects where published) as projects`
  );
  return Object.fromEntries(MIRROR_ENTITY.map((entity) => [entity, Number(row[entity])])) as Record<MirrorEntity, number>;
}

function livePages(h: Harness, entity: MirrorEntity) {
  return h.fake.pagesIn(h.mapping[entity]!).filter((page) => !page.archived);
}

function entityOfDatabase(h: Harness, databaseId: string): MirrorEntity | undefined {
  return MIRROR_ENTITY.find((entity) => h.mapping[entity] === databaseId);
}

/** The entity each page create in the request log went to, in order. */
function createdEntities(h: Harness): (MirrorEntity | undefined)[] {
  return h.fake.requests
    .filter((request) => request.method === "POST" && request.path === "/pages")
    .map((request) => entityOfDatabase(h, (request.body as { parent: { database_id: string } }).parent.database_id));
}

function count(h: Harness, method: string, path: RegExp): number {
  return h.fake.requests.filter((request) => request.method === method && path.test(request.path)).length;
}

/** Fail page creates into one database with `status`, `times` times. */
function failCreatesIn(h: Harness, databaseId: string, status: number, times = 1): void {
  const original = h.fake.handle;
  let left = times;
  h.fake.handle = (method, path, headers, body) => {
    const parsed = typeof body === "string" && body ? (JSON.parse(body) as { parent?: { database_id?: string } }) : null;
    if (left > 0 && method === "POST" && /\/pages$/.test(path) && parsed?.parent?.database_id === databaseId) {
      left -= 1;
      h.fake.requests.push({ method, path: "/pages", body: parsed, at: Date.now() });
      const response: NotionFakeResponse = {
        status,
        headers: { "Content-Type": "application/json" },
        body: { object: "error", status, code: "internal_server_error", message: "Injected." },
      };
      return response;
    }
    return original(method, path, headers, body);
  };
}

async function mirrorRow(h: Harness) {
  const [row] = await rawRows<{
    last_synced_at: string | null;
    last_status: string | null;
    last_error: unknown;
    running_since: string | null;
    paused_at: string | null;
  }>(
    h.db,
    sql`select last_synced_at::text, last_status, last_error, running_since::text, paused_at::text from notion_mirrors where id = ${h.mirrorId}`
  );
  return row;
}

describe("pushMirror", () => {
  it("creates every page on the first run, and updates in place on the second", async () => {
    const h = await harness();
    const expected = await expectedCounts(h.db);

    const first = await h.push();
    const total = Object.values(expected).reduce((a, b) => a + b, 0);
    expect(first).toEqual({ state: "ok", pushed: total, archived: 0 });
    for (const entity of MIRROR_ENTITY) expect(livePages(h, entity), entity).toHaveLength(expected[entity]);
    const afterFirst = await mirrorRow(h);
    expect(afterFirst.last_status).toBe("ok");
    expect(afterFirst.last_synced_at).not.toBeNull();
    expect(afterFirst.running_since).toBeNull();

    // Relations point at the pages the mirror made.
    const [form4] = await h.db.select({ id: tools.id }).from(tools).where(eq(tools.slug, "form-4"));
    const toolPage = livePages(h, "tools").find((page) => JSON.stringify(page.properties["App ID"]).includes(form4?.id ?? "none"));
    expect(toolPage).toBeDefined();
    const unitPages = livePages(h, "units").filter((page) => JSON.stringify(page.properties.Tool).includes(toolPage!.id));
    expect(unitPages.length).toBeGreaterThan(0);

    h.fake.requests.length = 0;
    await h.db.update(tools).set({ description: "Updated by the second run." }).where(eq(tools.id, form4.id));
    const second = await h.push();
    expect(second).toEqual({ state: "ok", pushed: 1, archived: 0 });
    expect(count(h, "POST", /^\/pages$/)).toBe(0);
    expect(count(h, "PATCH", /^\/pages\//)).toBe(1);
    expect(JSON.stringify(h.fake.pages.get(toolPage!.id)!.properties.Description)).toContain("Updated by the second run.");
    for (const entity of MIRROR_ENTITY) expect(livePages(h, entity), entity).toHaveLength(expected[entity]);

    // A third run with nothing changed makes no request at all.
    h.fake.requests.length = 0;
    expect(await h.push()).toEqual({ state: "ok", pushed: 0, archived: 0 });
    expect(h.fake.requests).toEqual([]);
  });

  it("pushes in dependency order", async () => {
    const h = await harness();
    await h.push();
    const order = createdEntities(h).map((entity) => MIRROR_ENTITY.indexOf(entity!));
    expect(order.length).toBeGreaterThan(0);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(createdEntities(h))).toEqual(new Set(MIRROR_ENTITY));
  });

  it("carries the maintenance reporter's email and the draft flag to Notion", async () => {
    const h = await harness();
    const [log] = await h.db.select({ email: maintenanceLogs.reportedByEmail }).from(maintenanceLogs).where(sql`${maintenanceLogs.reportedByEmail} is not null`);
    await h.db.update(tools).set({ published: false }).where(eq(tools.slug, "form-4"));
    await h.push();
    expect(JSON.stringify(livePages(h, "maintenance").map((page) => page.properties["Reporter email"]))).toContain(log.email!);
    const drafts = livePages(h, "tools").filter((page) => page.properties.Published.checkbox === false);
    expect(drafts).toHaveLength(1);
  });

  it("archives the page of an archived tool", async () => {
    const h = await harness();
    await h.push();
    const [form4] = await h.db.select({ id: tools.id }).from(tools).where(eq(tools.slug, "form-4"));
    const [page] = await h.db.select({ id: mirrorPages.notionPageId }).from(mirrorPages).where(eq(mirrorPages.entityId, form4.id));

    h.fake.requests.length = 0;
    await h.db.update(tools).set({ archivedAt: new Date() }).where(eq(tools.id, form4.id));
    expect(await h.push()).toEqual({ state: "ok", pushed: 0, archived: 1 });
    expect(h.fake.pages.get(page.id)!.archived).toBe(true);
    expect(h.fake.requests.find((request) => request.method === "PATCH")?.body).toEqual({ archived: true });

    // Archived once is archived: the next push sends nothing for it.
    h.fake.requests.length = 0;
    expect(await h.push()).toEqual({ state: "ok", pushed: 0, archived: 0 });

    // Unarchived, the same page comes back.
    await h.db.update(tools).set({ archivedAt: null }).where(eq(tools.id, form4.id));
    expect(await h.push()).toEqual({ state: "ok", pushed: 1, archived: 0 });
    expect(h.fake.pages.get(page.id)!.archived).toBe(false);
  });

  it("archives a withdrawn project's page, and never mirrors an unpublished one", async () => {
    const h = await harness();
    await h.push();
    const before = livePages(h, "projects").length;
    const [published] = await h.db.select({ id: projects.id }).from(projects).where(eq(projects.published, true)).limit(1);
    await h.db.update(projects).set({ published: false }).where(eq(projects.id, published.id));
    expect(await h.push()).toEqual({ state: "ok", pushed: 0, archived: 1 });
    expect(livePages(h, "projects")).toHaveLength(before - 1);
  });

  it("honours Retry-After on a 429", async () => {
    const h = await harness();
    h.fake.failNext({ method: "POST", path: /^\/pages$/ }, { status: 429, retryAfter: 2 }, 1);
    const outcome = await h.push();
    expect(outcome.state).toBe("ok");
    expect(h.sleep).toHaveBeenCalledWith(2000);
    const expected = await expectedCounts(h.db);
    for (const entity of MIRROR_ENTITY) expect(livePages(h, entity), entity).toHaveLength(expected[entity]);
  });

  it("is skipped, with no request, while another push holds the guard", async () => {
    const h = await harness();
    await h.db.update(notionMirrors).set({ runningSince: sql`now()` }).where(eq(notionMirrors.id, h.mirrorId));
    expect(await h.push()).toEqual({ state: "skipped", reason: "running" });
    expect(h.fake.requests).toEqual([]);

    // A guard older than fifteen minutes belongs to a push that died.
    await h.db
      .update(notionMirrors)
      .set({ runningSince: sql`now() - interval '16 minutes'` })
      .where(eq(notionMirrors.id, h.mirrorId));
    expect((await h.push()).state).toBe("ok");
  });

  it("is skipped, with no request, when paused", async () => {
    const h = await harness();
    await setMirrorPaused(h.ownerId, true, { db: h.db });
    expect(await h.push()).toEqual({ state: "skipped", reason: "paused" });
    expect(h.fake.requests).toEqual([]);
  });

  it("is skipped as not_mapped with no mapping, and frees the guard", async () => {
    const h = await harness({ databases: false });
    expect(await h.push()).toEqual({ state: "skipped", reason: "not_mapped" });
    expect(h.fake.requests).toEqual([]);
    expect((await mirrorRow(h)).running_since).toBeNull();
  });

  it("on a partial failure keeps last_synced_at, and the next push creates only the failed row", async () => {
    const h = await harness();
    await h.push();
    const synced = (await mirrorRow(h)).last_synced_at!;

    // Two changes: a new project (a leaf) whose create fails, and a renamed category that succeeds.
    await h.db.insert(projects).values({ slug: `new-${crypto.randomUUID()}`, title: "New project", published: true });
    const [category] = await h.db.select({ id: categories.id }).from(categories).limit(1);
    await h.db.update(categories).set({ name: "Renamed" }).where(eq(categories.id, category.id));
    failCreatesIn(h, h.mapping.projects!, 500);

    h.fake.requests.length = 0;
    const partial = await h.push();
    expect(partial).toMatchObject({ state: "partial", pushed: 1, failed: 1, error: { code: "rows_failed", entities: ["projects"], failed: 1 } });
    const row = await mirrorRow(h);
    expect(row.last_status).toBe("partial");
    const [same] = await rawRows<{ same: boolean }>(
      h.db,
      sql`select (last_synced_at = ${synced}::timestamptz) as same from notion_mirrors where id = ${h.mirrorId}`
    );
    expect(same.same).toBe(true);

    h.fake.requests.length = 0;
    expect(await h.push()).toEqual({ state: "ok", pushed: 1, archived: 0 });
    expect(createdEntities(h)).toEqual(["projects"]);
    expect(count(h, "PATCH", /^\/pages\//)).toBe(0);
    expect((await mirrorRow(h)).last_status).toBe("ok");
  });

  it("pauses the mirror and records unauthorized on a 401", async () => {
    const h = await harness();
    h.fake.failNext({}, { status: 401, code: "unauthorized" }, 1);
    const outcome = await h.push();
    expect(outcome).toMatchObject({ state: "failed", paused: true, error: { code: "unauthorized" } });
    const row = await mirrorRow(h);
    expect(row.paused_at).not.toBeNull();
    expect(row.last_status).toBe("failed");
    expect(row.last_error).toMatchObject({ code: "unauthorized" });
    expect(row.running_since).toBeNull();

    h.fake.requests.length = 0;
    expect(await h.push()).toEqual({ state: "skipped", reason: "paused" });
    expect(h.fake.requests).toEqual([]);
  });

  it("fails without pausing when AUTH_SECRET is unset, and pauses when the token cannot be read", async () => {
    const h = await harness();
    vi.stubEnv("AUTH_SECRET", "");
    expect(await h.push()).toMatchObject({ state: "failed", paused: false, error: { code: "key_unavailable" } });
    expect((await mirrorRow(h)).paused_at).toBeNull();

    vi.stubEnv("AUTH_SECRET", "a-rotated-auth-secret");
    expect(await h.push()).toMatchObject({ state: "failed", paused: true, error: { code: "token_unreadable" } });
    expect((await mirrorRow(h)).paused_at).not.toBeNull();
    expect(h.fake.requests).toEqual([]);
  });

  it("stops at the budget without advancing, and the next push continues without re-pushing", async () => {
    const h = await harness();
    const expected = await expectedCounts(h.db);
    const total = Object.values(expected).reduce((a, b) => a + b, 0);

    // One request per second on the fake clock, 4.5 s of budget: a handful of requests.
    const cut = await h.push({ budgetMs: 4_500, requestsPerSecond: 1 });
    expect(cut.state).toBe("incomplete");
    const firstPushed = cut.state === "incomplete" ? cut.pushed : -1;
    expect(firstPushed).toBeGreaterThan(0);
    expect(firstPushed).toBeLessThan(total);
    const row = await mirrorRow(h);
    expect(row.last_synced_at).toBeNull();
    expect(row.last_status).toBe("partial");
    expect(row.last_error).toMatchObject({ code: "budget_exhausted" });

    const createsBefore = count(h, "POST", /^\/pages$/);
    const rest = await h.push();
    expect(rest).toEqual({ state: "ok", pushed: total - firstPushed, archived: 0 });
    expect(count(h, "POST", /^\/pages$/) - createsBefore).toBe(total - firstPushed);
    for (const entity of MIRROR_ENTITY) expect(livePages(h, entity), entity).toHaveLength(expected[entity]);
  });

  it("fails one entity whose database is gone and pushes the others", async () => {
    const h = await harness();
    const expected = await expectedCounts(h.db);
    h.fake.databases.delete(h.mapping.resources!);

    const outcome = await h.push();
    expect(outcome).toMatchObject({ state: "partial", failed: 0, error: { code: "database_not_found", entities: ["resources"] } });
    for (const entity of MIRROR_ENTITY.filter((entity) => entity !== "resources")) {
      expect(livePages(h, entity), entity).toHaveLength(expected[entity]);
    }
    expect(createdEntities(h)).not.toContain(undefined);
    const row = await mirrorRow(h);
    expect(row.last_synced_at).toBeNull();
    expect(row.last_status).toBe("partial");

    // Create databases recreates it; the next push fills it.
    const ensured = await ensureMirrorDatabases(h.mirrorId, { db: h.db, client: { requestsPerSecond: 0 } });
    if (!ensured.ok) throw new Error(ensured.code);
    h.mapping = ensured.mapping;
    expect(await h.push()).toMatchObject({ state: "ok", pushed: expected.resources });
    expect(livePages(h, "resources")).toHaveLength(expected.resources);
  });

  it("after the Tools database is recreated, re-pushes every page that links to a tool", async () => {
    const h = await harness();
    expect(await h.push()).toMatchObject({ state: "ok" });
    const oldToolsDatabase = h.mapping.tools!;
    const oldToolPages = new Set(h.fake.pagesIn(oldToolsDatabase).map((page) => page.id));
    h.fake.databases.delete(oldToolsDatabase);

    expect(await h.push()).toEqual({ state: "ok", pushed: 0, archived: 0 });
    const ensured = await ensureMirrorDatabases(h.mirrorId, { db: h.db, client: { requestsPerSecond: 0 } });
    if (!ensured.ok) throw new Error(ensured.code);
    expect(ensured.created).toEqual(["tools"]);
    h.mapping = ensured.mapping;

    expect(await h.push()).toMatchObject({ state: "ok" });
    const newToolPages = new Set(livePages(h, "tools").map((page) => page.id));
    expect(newToolPages.size).toBeGreaterThan(0);

    // Every Tool / Tools relation now points into the new database, none into the old.
    const linked = (entity: MirrorEntity, property: string) =>
      livePages(h, entity).flatMap((page) =>
        ((page.properties[property] as { relation?: { id: string }[] } | undefined)?.relation ?? []).map((r) => r.id)
      );
    for (const [entity, property] of [
      ["units", "Tool"],
      ["resources", "Tool"],
      ["maintenance", "Tool"],
      ["projects", "Tools"],
    ] as const) {
      const ids = linked(entity, property);
      expect(ids.length, entity).toBeGreaterThan(0);
      for (const id of ids) {
        expect(oldToolPages.has(id), `${entity} still links to an old tool page`).toBe(false);
        expect(newToolPages.has(id), entity).toBe(true);
      }
    }
    const row = await mirrorRow(h);
    expect(row.last_status).toBe("ok");
  });

  it("a mapping reset during the push stops it without advancing or recording pages into the old database", async () => {
    const h = await harness();
    let calls = 0;
    h.sleep.mockImplementation(async (ms: number) => {
      h.clock.t += ms;
      calls += 1;
      // A few requests in: Create databases recreates the categories database.
      if (calls === 3) await resetMirrorEntities(h.mirrorId, ["categories"], { db: h.db });
    });

    const outcome = await h.push({ requestsPerSecond: 3 });

    expect(outcome.state).toBe("incomplete");
    const row = await mirrorRow(h);
    expect(row.last_synced_at).toBeNull();
    expect(row.running_since).toBeNull();
    const [recorded] = await rawRows<{ n: number }>(
      h.db,
      sql`select count(*)::int as n from mirror_pages where mirror_id = ${h.mirrorId} and entity = 'categories'`
    );
    expect(Number(recorded.n)).toBe(0);
  });

  it("recreates a page deleted by hand", async () => {
    const h = await harness();
    await h.push();
    const [category] = await h.db.select({ id: categories.id }).from(categories).limit(1);
    const [page] = await h.db.select({ id: mirrorPages.notionPageId }).from(mirrorPages).where(eq(mirrorPages.entityId, category.id));
    h.fake.pages.delete(page.id);
    await h.db.update(categories).set({ name: "Touched" }).where(eq(categories.id, category.id));

    expect(await h.push()).toEqual({ state: "ok", pushed: 1, archived: 0 });
    const [again] = await h.db.select({ id: mirrorPages.notionPageId }).from(mirrorPages).where(eq(mirrorPages.entityId, category.id));
    expect(again.id).not.toBe(page.id);
    expect(h.fake.pages.has(again.id)).toBe(true);
  });

  it("archives an orphaned unit page and forgets it", async () => {
    const h = await harness();
    await h.push();
    const [unit] = await h.db.select({ id: units.id }).from(units).limit(1);
    const [page] = await h.db.select({ id: mirrorPages.notionPageId }).from(mirrorPages).where(eq(mirrorPages.entityId, unit.id));
    await h.db.delete(units).where(eq(units.id, unit.id));

    const outcome = await h.push();
    expect(outcome).toMatchObject({ state: "ok", archived: 1 });
    expect(h.fake.pages.get(page.id)!.archived).toBe(true);
    expect(await h.db.select().from(mirrorPages).where(eq(mirrorPages.entityId, unit.id))).toEqual([]);
  });

  it("releases the guard and records the failure when the database throws", async () => {
    const h = await harness();
    await h.db.execute(sql`alter table maintenance_logs rename to maintenance_logs_gone`);
    await expect(h.push()).rejects.toThrow();
    const row = await mirrorRow(h);
    expect(row.running_since).toBeNull();
    expect(row.last_status).toBe("failed");
    expect(row.last_error).toMatchObject({ code: "unknown" });
  });

  it("never lets the token or an email reach the console, last_error or a thrown message", async () => {
    const lines: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
      });
    }
    const h = await harness();
    const [log] = await h.db.select({ email: maintenanceLogs.reportedByEmail }).from(maintenanceLogs).where(sql`${maintenanceLogs.reportedByEmail} is not null`);

    // A Notion error whose message quotes the token and an email.
    h.fake.failNext({ method: "POST", path: /^\/pages$/ }, { status: 400, message: `bad ${TOKEN} for ${log.email}` }, 2);
    await h.push();
    h.fake.failNext({}, { status: 401, message: `revoked ${TOKEN}` }, 1);
    await h.push();
    const errors = JSON.stringify((await getMirror(h.mirrorId, { db: h.db }))!.lastError);

    await h.db.update(notionMirrors).set({ pausedAt: null }).where(eq(notionMirrors.id, h.mirrorId));
    await h.db.execute(sql`alter table projects rename to projects_gone`);
    const thrown = await h.push().catch((error: unknown) => String((error as Error)?.message ?? error));

    expect(lines.length).toBeGreaterThan(0);
    for (const text of [...lines, errors, String(thrown)]) {
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain("ntn_");
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(log.email!);
    }
  });
});
