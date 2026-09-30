// @vitest-environment node
import { eq, sql } from "drizzle-orm";
import { createPgliteDb } from "../db/pglite";
import { rawRows } from "../db/raw";
import { categories, mirrorPages, notionMirrors, tools, user } from "../db/schema/index";
import type { Db } from "../db/types";
import {
  claimCoalescedPush,
  claimManualSync,
  claimMirrorRun,
  disconnectMirror,
  finishMirrorRun,
  getMirror,
  getMirrorForOwner,
  getMirrorTokenCiphertext,
  getMirrorViewForOwner,
  listMirrorsDueForBackstop,
  normalizeMirrorMapping,
  releaseCoalescedPush,
  releaseManualSync,
  releaseMirrorRun,
  resetMirrorEntities,
  saveMirrorConnection,
  setMirrorMapping,
  setMirrorPaused,
  takeCoalescedPush,
  type ClaimedMirror,
} from "./mirrors";

/**
 * `notion_mirrors` against PGlite (spec §3.8, §4.12, §8). Every time window is
 * staged with SQL relative to the database's own `now()`, the same clock the
 * claims read, so nothing here depends on the test machine's clock agreeing
 * with Postgres'.
 */

const PAGE = "0f5e4a3c-1111-2222-3333-444455556666";
const TOKEN_BYTES = new Uint8Array([1, 9, 9, 7, 42]);

async function insertUser(db: Db): Promise<string> {
  const id = `u-${Math.random().toString(36).slice(2)}`;
  await db.insert(user).values({ id, name: "Mirror Owner", email: `${id}@cornell.edu`, role: "admin" });
  return id;
}

async function connected(db: Db, mapping: Record<string, string> = { tools: "db-tools" }) {
  const owner = await insertUser(db);
  const { mirror } = await saveMirrorConnection(
    { ownerUserId: owner, tokenCiphertext: TOKEN_BYTES, parentPageId: PAGE, parentPageTitle: "Mirror" },
    { db }
  );
  if (Object.keys(mapping).length) await setMirrorMapping(mirror.id, mapping, { db });
  return { owner, id: mirror.id };
}

async function stage(db: Db, id: string, assignments: string): Promise<void> {
  await db.execute(sql`update notion_mirrors set ${sql.raw(assignments)} where id = ${id}`);
}

function isClaimed(result: Awaited<ReturnType<typeof claimMirrorRun>>): result is ClaimedMirror {
  return !("skipped" in result);
}

describe("mirror connection", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createPgliteDb();
  });

  it("creates the owner's mirror, then reconnects it in place", async () => {
    const owner = await insertUser(db);
    const first = await saveMirrorConnection(
      { ownerUserId: owner, tokenCiphertext: TOKEN_BYTES, parentPageId: PAGE, parentPageTitle: "Mirror" },
      { db }
    );
    expect(first.created).toBe(true);
    expect(first.mirror).toMatchObject({ ownerUserId: owner, hasToken: true, parentPageId: PAGE, mapping: {} });
    expect("tokenCiphertext" in first.mirror).toBe(false);

    const second = await saveMirrorConnection(
      { ownerUserId: owner, tokenCiphertext: new Uint8Array([7]), parentPageId: PAGE, parentPageTitle: "Renamed" },
      { db }
    );
    expect(second.created).toBe(false);
    expect(second.mirror.id).toBe(first.mirror.id);
    expect(second.mirror.parentPageTitle).toBe("Renamed");
    expect(Array.from((await getMirrorTokenCiphertext(first.mirror.id, { db }))!)).toEqual([7]);
  });

  it("reconnecting keeps the mapping and pages, resumes, and clears an error the old token caused", async () => {
    const { owner, id } = await connected(db, { tools: "db-tools", units: "db-units" });
    const entityId = crypto.randomUUID();
    await db.insert(mirrorPages).values({ mirrorId: id, entity: "tools", entityId, notionPageId: "p-1" });
    await db
      .update(notionMirrors)
      .set({
        pausedAt: sql`now()`,
        lastStatus: "failed",
        lastError: { code: "unauthorized", entities: [], failed: 0, detail: "Notion 401 unauthorized" },
      })
      .where(eq(notionMirrors.id, id));

    const { mirror } = await saveMirrorConnection(
      { ownerUserId: owner, tokenCiphertext: TOKEN_BYTES, parentPageId: PAGE, parentPageTitle: null },
      { db }
    );

    expect(mirror.pausedAt).toBeNull();
    expect(mirror.lastError).toBeNull();
    expect(mirror.mapping).toEqual({ tools: "db-tools", units: "db-units" });
    const pages = await db.select().from(mirrorPages).where(eq(mirrorPages.mirrorId, id));
    expect(pages).toHaveLength(1);
  });

  it("reconnecting keeps an error the token did not cause", async () => {
    const { owner, id } = await connected(db);
    const error = { code: "database_not_found" as const, entities: ["tools" as const], failed: 0, detail: null };
    await db.update(notionMirrors).set({ lastError: error }).where(eq(notionMirrors.id, id));

    const { mirror } = await saveMirrorConnection(
      { ownerUserId: owner, tokenCiphertext: TOKEN_BYTES, parentPageId: PAGE, parentPageTitle: null },
      { db }
    );
    expect(mirror.lastError).toEqual(error);
  });

  it("finds a mirror by owner and by id, and nothing for a malformed id", async () => {
    const { owner, id } = await connected(db);
    expect((await getMirrorForOwner(owner, { db }))?.id).toBe(id);
    expect((await getMirror(id, { db }))?.ownerUserId).toBe(owner);
    expect(await getMirror("not-a-uuid", { db })).toBeNull();
    expect(await getMirror(crypto.randomUUID(), { db })).toBeNull();
    expect(await getMirrorForOwner("nobody", { db })).toBeNull();
    expect(await getMirrorTokenCiphertext("not-a-uuid", { db })).toBeNull();
  });

  it("disconnect forgets the token and the pending push, and keeps the mapping and pages", async () => {
    const { owner, id } = await connected(db, { tools: "db-tools" });
    await db.insert(mirrorPages).values({ mirrorId: id, entity: "tools", entityId: crypto.randomUUID(), notionPageId: "p" });
    await stage(db, id, "push_requested_at = now()");

    expect(await disconnectMirror(owner, { db })).toBe(true);

    const mirror = await getMirror(id, { db });
    expect(mirror?.hasToken).toBe(false);
    expect(mirror?.pushRequestedAt).toBeNull();
    expect(mirror?.mapping).toEqual({ tools: "db-tools" });
    expect(await getMirrorTokenCiphertext(id, { db })).toBeNull();
    expect(await db.select().from(mirrorPages).where(eq(mirrorPages.mirrorId, id))).toHaveLength(1);

    expect(await disconnectMirror("nobody", { db })).toBe(false);
  });

  it("stores a normalised mapping", async () => {
    const { id } = await connected(db, {});
    const mirror = await setMirrorMapping(
      id,
      { tools: " db-tools ", units: "", bogus: "db-x" } as unknown as Record<string, string>,
      { db }
    );
    expect(mirror.mapping).toEqual({ tools: "db-tools" });
    await expect(setMirrorMapping(crypto.randomUUID(), {}, { db })).rejects.toThrow(/does not exist/);
  });

  it("normalizeMirrorMapping keeps only known entities with string ids", () => {
    expect(normalizeMirrorMapping(null)).toEqual({});
    expect(normalizeMirrorMapping(["tools"])).toEqual({});
    expect(normalizeMirrorMapping({ projects: "p", tools: 3, maintenance: "m" })).toEqual({ maintenance: "m", projects: "p" });
  });

  it("resetMirrorEntities clears only its entities' pages, and forces a full push", async () => {
    const { id } = await connected(db);
    const rows = (["tools", "units", "categories"] as const).map((entity) => ({
      mirrorId: id,
      entity,
      entityId: crypto.randomUUID(),
      notionPageId: `p-${entity}`,
    }));
    await db.insert(mirrorPages).values(rows);
    await stage(db, id, "last_synced_at = now()");

    await resetMirrorEntities(id, ["tools", "units"], { db });

    const left = await db.select({ entity: mirrorPages.entity }).from(mirrorPages).where(eq(mirrorPages.mirrorId, id));
    expect(left.map((row) => row.entity)).toEqual(["categories"]);
    expect((await getMirror(id, { db }))?.lastSyncedAt).toBeNull();
  });

  it("resetMirrorEntities marks the pages that link to the reset entities as not mirrored, and only those", async () => {
    const { id } = await connected(db);
    const entities = ["categories", "tools", "units", "resources", "maintenance", "projects"] as const;
    await db.insert(mirrorPages).values(
      entities.map((entity) => ({
        mirrorId: id,
        entity,
        entityId: crypto.randomUUID(),
        notionPageId: `p-${entity}`,
        sourceUpdatedAt: sql`now()`,
      }))
    );

    // Tools recreated: every entity with a Tool / Tools relation must push again.
    await resetMirrorEntities(id, ["tools"], { db });
    const afterTools = await rawRows<{ entity: string; stale: boolean }>(
      db,
      sql`select entity, source_updated_at is null as stale from mirror_pages where mirror_id = ${id} order by entity`
    );
    expect(Object.fromEntries(afterTools.map((row) => [row.entity, row.stale]))).toEqual({
      categories: false,
      maintenance: true,
      projects: true,
      resources: true,
      units: true,
    });

    // Units recreated: only maintenance links to a unit.
    await db.execute(sql`update mirror_pages set source_updated_at = now() where mirror_id = ${id}`);
    await resetMirrorEntities(id, ["units"], { db });
    const afterUnits = await rawRows<{ entity: string; stale: boolean }>(
      db,
      sql`select entity, source_updated_at is null as stale from mirror_pages where mirror_id = ${id} order by entity`
    );
    expect(Object.fromEntries(afterUnits.map((row) => [row.entity, row.stale]))).toEqual({
      categories: false,
      maintenance: true,
      projects: false,
      resources: false,
    });
  });

  it("a mapping change or reset moves the generation; saving the same mapping does not", async () => {
    const { id } = await connected(db, { tools: "db-tools" });
    const generation = async () =>
      Number((await rawRows<{ g: number }>(db, sql`select mapping_generation as g from notion_mirrors where id = ${id}`))[0].g);
    const start = await generation();

    await setMirrorMapping(id, { tools: "db-tools" }, { db });
    expect(await generation()).toBe(start);
    await setMirrorMapping(id, { tools: "db-tools", units: "db-units" }, { db });
    expect(await generation()).toBe(start + 1);
    await resetMirrorEntities(id, ["units"], { db });
    expect(await generation()).toBe(start + 2);
  });

  it("pauses and resumes, keeping the first paused_at", async () => {
    const { owner, id } = await connected(db);
    await stage(db, id, "paused_at = now() - interval '1 hour'");
    const before = (await getMirror(id, { db }))!.pausedAt!;

    const paused = await setMirrorPaused(owner, true, { db });
    expect(paused?.pausedAt?.getTime()).toBe(before.getTime());

    const resumed = await setMirrorPaused(owner, false, { db });
    expect(resumed?.pausedAt).toBeNull();
    expect(await setMirrorPaused("nobody", true, { db })).toBeNull();
  });
});

describe("claimMirrorRun and finishMirrorRun", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createPgliteDb();
  });

  it("claims an idle, connected, unpaused mirror and hands over the ciphertext", async () => {
    const { id } = await connected(db);
    const result = await claimMirrorRun(id, { db });
    expect(isClaimed(result)).toBe(true);
    if (!isClaimed(result)) return;
    expect(result.id).toBe(id);
    expect(result.runningSince).toBeInstanceOf(Date);
    expect(Array.from(result.tokenCiphertext!)).toEqual(Array.from(TOKEN_BYTES));
    expect(result.since).toBeNull();
  });

  it("skips a paused mirror", async () => {
    const { id } = await connected(db);
    await stage(db, id, "paused_at = now()");
    expect(await claimMirrorRun(id, { db })).toEqual({ skipped: "paused" });
  });

  it("skips a disconnected mirror", async () => {
    const { owner, id } = await connected(db);
    await disconnectMirror(owner, { db });
    expect(await claimMirrorRun(id, { db })).toEqual({ skipped: "not_connected" });
  });

  it("skips a mirror another push claimed less than 15 minutes ago", async () => {
    const { id } = await connected(db);
    expect(isClaimed(await claimMirrorRun(id, { db }))).toBe(true);
    expect(await claimMirrorRun(id, { db })).toEqual({ skipped: "running" });

    await stage(db, id, "running_since = now() - interval '14 minutes'");
    expect(await claimMirrorRun(id, { db })).toEqual({ skipped: "running" });
  });

  it("takes over a push that has been running for more than 15 minutes", async () => {
    const { id } = await connected(db);
    await stage(db, id, "running_since = now() - interval '16 minutes'");
    expect(isClaimed(await claimMirrorRun(id, { db }))).toBe(true);
  });

  it("is not_found for an unknown or malformed id", async () => {
    expect(await claimMirrorRun(crypto.randomUUID(), { db })).toEqual({ skipped: "not_found" });
    expect(await claimMirrorRun("nope", { db })).toEqual({ skipped: "not_found" });
  });

  it("takes the watermark 5 minutes before the claim, in the same statement", async () => {
    const { id } = await connected(db);
    const result = await claimMirrorRun(id, { db });
    if (!isClaimed(result)) throw new Error("expected a claim");

    const [check] = await rawRows<{ same: boolean }>(
      db,
      sql`select (${result.watermark}::timestamptz = running_since - interval '5 minutes') as same from notion_mirrors where id = ${id}`
    );
    expect(check.same).toBe(true);
  });

  it("carries last_synced_at as text with its microseconds, and advances to text the same way", async () => {
    const { id } = await connected(db);
    await stage(db, id, "last_synced_at = '2026-09-23 10:00:00.123456+00'");

    const result = await claimMirrorRun(id, { db });
    if (!isClaimed(result)) throw new Error("expected a claim");
    expect(result.since).toMatch(/\.123456/);
    // Whatever the session's TimeZone, the text names the same instant.
    const [same] = await rawRows<{ same: boolean }>(
      db,
      sql`select (${result.since}::timestamptz = '2026-09-23 10:00:00.123456+00'::timestamptz) as same`
    );
    expect(same.same).toBe(true);

    await finishMirrorRun(
      id,
      { status: "ok", error: null, advanceTo: "2026-09-23 11:00:00.654321+00", pause: false, generation: result.generation },
      { db }
    );
    const [row] = await rawRows<{ synced: string }>(
      db,
      sql`select (last_synced_at at time zone 'UTC')::text as synced from notion_mirrors where id = ${id}`
    );
    expect(row.synced).toMatch(/11:00:00\.654321/);
  });

  it("finishing clears the guard, stamps last_run_at and records the result", async () => {
    const { id } = await connected(db);
    await claimMirrorRun(id, { db });
    const error = { code: "rows_failed" as const, entities: ["tools" as const], failed: 2, detail: "Notion 400 validation_error" };

    await finishMirrorRun(id, { status: "partial", error, advanceTo: null, pause: false, generation: 1 }, { db });

    const mirror = (await getMirror(id, { db }))!;
    expect(mirror.runningSince).toBeNull();
    expect(mirror.lastRunAt).toBeInstanceOf(Date);
    expect(mirror.lastStatus).toBe("partial");
    expect(mirror.lastError).toEqual(error);
    expect(mirror.pausedAt).toBeNull();
    // A partial push does not advance: the failed rows are selected again.
    expect(mirror.lastSyncedAt).toBeNull();
    expect(isClaimed(await claimMirrorRun(id, { db }))).toBe(true);
  });

  it("keeps last_synced_at when advanceTo is null, and pauses when asked", async () => {
    const { id } = await connected(db);
    await stage(db, id, "last_synced_at = '2026-09-01 00:00:00.000001+00'");
    await claimMirrorRun(id, { db });

    await finishMirrorRun(
      id,
      {
        status: "failed",
        error: { code: "unauthorized", entities: [], failed: 0, detail: null },
        advanceTo: null,
        pause: true,
        generation: 1,
      },
      { db }
    );

    const [row] = await rawRows<{ synced: string; paused: boolean }>(
      db,
      sql`select (last_synced_at at time zone 'UTC')::text as synced, paused_at is not null as paused from notion_mirrors where id = ${id}`
    );
    expect(row.synced).toMatch(/2026-09-01 00:00:00\.000001/);
    expect(row.paused).toBe(true);
    expect(await claimMirrorRun(id, { db })).toEqual({ skipped: "paused" });
  });

  it("does not advance last_synced_at over a reset that landed during the push", async () => {
    const { id } = await connected(db);
    await stage(db, id, "last_synced_at = '2026-09-01 00:00:00+00'");
    const claim = await claimMirrorRun(id, { db });
    if (!isClaimed(claim)) throw new Error("expected a claim");

    // Create databases made the categories database while the push ran.
    await resetMirrorEntities(id, ["categories"], { db });
    const finished = await finishMirrorRun(
      id,
      { status: "ok", error: null, advanceTo: claim.watermark, pause: false, generation: claim.generation },
      { db }
    );

    expect(finished).toEqual({ current: false });
    const mirror = (await getMirror(id, { db }))!;
    expect(mirror.lastSyncedAt).toBeNull();
    expect(mirror.runningSince).toBeNull();
  });

  it("does not advance last_synced_at over a mapping change during the push, even from a first sync", async () => {
    const { id } = await connected(db, { tools: "db-tools" });
    const claim = await claimMirrorRun(id, { db });
    if (!isClaimed(claim)) throw new Error("expected a claim");
    expect(claim.since).toBeNull();

    await setMirrorMapping(id, { tools: "db-tools", categories: "db-categories" }, { db });
    const finished = await finishMirrorRun(
      id,
      { status: "ok", error: null, advanceTo: claim.watermark, pause: false, generation: claim.generation },
      { db }
    );

    expect(finished).toEqual({ current: false });
    expect((await getMirror(id, { db }))!.lastSyncedAt).toBeNull();
  });

  it("advances when nothing changed the mapping during the push", async () => {
    const { id } = await connected(db);
    const claim = await claimMirrorRun(id, { db });
    if (!isClaimed(claim)) throw new Error("expected a claim");
    const finished = await finishMirrorRun(
      id,
      { status: "ok", error: null, advanceTo: claim.watermark, pause: false, generation: claim.generation },
      { db }
    );
    expect(finished).toEqual({ current: true });
    expect((await getMirror(id, { db }))!.lastSyncedAt).toBeInstanceOf(Date);
  });

  it("skips the mirror of an owner who was demoted or banned", async () => {
    const demoted = await connected(db);
    await db.update(user).set({ role: "user" }).where(eq(user.id, demoted.owner));
    expect(await claimMirrorRun(demoted.id, { db })).toEqual({ skipped: "owner_not_allowed" });

    const banned = await connected(db);
    await db.update(user).set({ banned: true }).where(eq(user.id, banned.owner));
    expect(await claimMirrorRun(banned.id, { db })).toEqual({ skipped: "owner_not_allowed" });

    // Promoted back, or unbanned: the mirror pushes again.
    await db.update(user).set({ role: "super_admin" }).where(eq(user.id, demoted.owner));
    expect(isClaimed(await claimMirrorRun(demoted.id, { db }))).toBe(true);
  });

  it("releasing a run frees the guard and stamps last_run_at without touching the result", async () => {
    const { id } = await connected(db);
    const error = { code: "rows_failed" as const, entities: ["tools" as const], failed: 1, detail: null };
    await claimMirrorRun(id, { db });
    await finishMirrorRun(id, { status: "partial", error, advanceTo: null, pause: false, generation: 1 }, { db });
    await stage(db, id, "last_run_at = now() - interval '1 hour'");
    await claimMirrorRun(id, { db });

    await releaseMirrorRun(id, { db });

    const [row] = await rawRows<{ recent: boolean }>(
      db,
      sql`select last_run_at > now() - interval '1 minute' as recent from notion_mirrors where id = ${id}`
    );
    expect(row.recent).toBe(true);
    const mirror = (await getMirror(id, { db }))!;
    expect(mirror.runningSince).toBeNull();
    expect(mirror.lastStatus).toBe("partial");
    expect(mirror.lastError).toEqual(error);
    expect(isClaimed(await claimMirrorRun(id, { db }))).toBe(true);
  });
});

describe("Sync now", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createPgliteDb();
  });

  it("claims once, then refuses for 15 minutes with the seconds left", async () => {
    const { owner, id } = await connected(db);
    expect(await claimManualSync(owner, { db })).toEqual({ ok: true, mirrorId: id });

    const again = await claimManualSync(owner, { db });
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.reason).toBe("too_soon");
    expect(again.retryAfterSeconds).toBeGreaterThan(890);
    expect(again.retryAfterSeconds).toBeLessThanOrEqual(900);

    await stage(db, id, "sync_requested_at = now() - interval '14 minutes'");
    const later = await claimManualSync(owner, { db });
    expect(later).toMatchObject({ ok: false, reason: "too_soon" });
    if (!later.ok) expect(later.retryAfterSeconds).toBeLessThanOrEqual(60);

    await stage(db, id, "sync_requested_at = now() - interval '16 minutes'");
    expect(await claimManualSync(owner, { db })).toEqual({ ok: true, mirrorId: id });
  });

  it("gives the claim back when the push could not start", async () => {
    const { owner, id } = await connected(db);
    await claimManualSync(owner, { db });
    await releaseManualSync(id, { db });
    expect(await claimManualSync(owner, { db })).toEqual({ ok: true, mirrorId: id });
  });

  it("refuses with the reason: not found, not connected, paused, not mapped", async () => {
    expect(await claimManualSync("nobody", { db })).toEqual({ ok: false, reason: "not_found" });

    const disconnected = await connected(db);
    await disconnectMirror(disconnected.owner, { db });
    expect(await claimManualSync(disconnected.owner, { db })).toEqual({ ok: false, reason: "not_connected" });

    const paused = await connected(db);
    await setMirrorPaused(paused.owner, true, { db });
    expect(await claimManualSync(paused.owner, { db })).toEqual({ ok: false, reason: "paused" });

    const unmapped = await connected(db, {});
    expect(await claimManualSync(unmapped.owner, { db })).toEqual({ ok: false, reason: "not_mapped" });
  });

  it("refuses while another push holds the mirror, without spending the window", async () => {
    const { owner, id } = await connected(db);
    await stage(db, id, "running_since = now()");

    expect(await claimManualSync(owner, { db })).toEqual({ ok: false, reason: "running" });
    expect((await getMirror(id, { db }))!.syncRequestedAt).toBeNull();

    // A push that died long ago does not hold it.
    await stage(db, id, "running_since = now() - interval '16 minutes'");
    expect(await claimManualSync(owner, { db })).toEqual({ ok: true, mirrorId: id });
  });
});

describe("coalesced pushes", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createPgliteDb();
  });

  it("claims every active mirror once, releases, reclaims when stale, and takes", async () => {
    const a = await connected(db);
    const b = await connected(db);
    const paused = await connected(db);
    await setMirrorPaused(paused.owner, true, { db });
    const gone = await connected(db);
    await disconnectMirror(gone.owner, { db });

    expect((await claimCoalescedPush({ db })).sort()).toEqual([a.id, b.id].sort());
    // A push is already on its way: a second change claims nothing.
    expect(await claimCoalescedPush({ db })).toEqual([]);

    await releaseCoalescedPush([a.id], { db });
    expect(await claimCoalescedPush({ db })).toEqual([a.id]);

    // A claim older than 10 minutes is a coalescing run that never finished.
    await stage(db, b.id, "push_requested_at = now() - interval '11 minutes'");
    expect(await claimCoalescedPush({ db })).toEqual([b.id]);

    // The run wakes: it clears every claim and pushes the mirrors still active.
    await stage(db, paused.id, "push_requested_at = now()");
    expect((await takeCoalescedPush({ db })).sort()).toEqual([a.id, b.id].sort());
    const [left] = await rawRows<{ n: number }>(
      db,
      sql`select count(*)::int as n from notion_mirrors where push_requested_at is not null`
    );
    expect(Number(left.n)).toBe(0);
    expect(await takeCoalescedPush({ db })).toEqual([]);
    expect((await claimCoalescedPush({ db })).sort()).toEqual([a.id, b.id].sort());
  });

  it("claims and takes nothing for a demoted or banned owner", async () => {
    const demoted = await connected(db);
    await db.update(user).set({ role: "user" }).where(eq(user.id, demoted.owner));
    const banned = await connected(db);
    await db.update(user).set({ banned: true }).where(eq(user.id, banned.owner));

    const claimed = await claimCoalescedPush({ db });
    expect(claimed).not.toContain(demoted.id);
    expect(claimed).not.toContain(banned.id);

    await stage(db, demoted.id, "push_requested_at = now()");
    expect(await takeCoalescedPush({ db })).not.toContain(demoted.id);
  });
});

describe("listMirrorsDueForBackstop", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createPgliteDb();
  });

  it("lists active, idle mirrors that are behind, and only those", async () => {
    const [category] = await db
      .insert(categories)
      .values({ name: "Backstop", group: "Test", updatedAt: sql`now() - interval '2 hours'` })
      .returning({ id: categories.id });
    await db.insert(tools).values({ name: "Old tool", slug: `old-${crypto.randomUUID()}`, updatedAt: sql`now() - interval '2 hours'` });

    const neverSynced = await connected(db);
    const upToDate = await connected(db);
    await stage(db, upToDate.id, "last_synced_at = now() - interval '1 hour', last_status = 'ok'");
    const partial = await connected(db);
    await stage(db, partial.id, "last_synced_at = now() - interval '1 hour', last_status = 'partial'");
    const running = await connected(db);
    await stage(db, running.id, "running_since = now()");
    const paused = await connected(db);
    await setMirrorPaused(paused.owner, true, { db });
    const disconnected = await connected(db);
    await disconnectMirror(disconnected.owner, { db });
    const demoted = await connected(db);
    await db.update(user).set({ role: "user" }).where(eq(user.id, demoted.owner));
    const banned = await connected(db);
    await db.update(user).set({ banned: true }).where(eq(user.id, banned.owner));

    expect((await listMirrorsDueForBackstop({ db })).sort()).toEqual([neverSynced.id, partial.id].sort());

    // A category edited after the last sync puts the up-to-date mirror behind.
    await db.update(categories).set({ name: "Backstop, renamed" }).where(eq(categories.id, category.id));
    expect((await listMirrorsDueForBackstop({ db })).sort()).toEqual(
      [neverSynced.id, partial.id, upToDate.id].sort()
    );
  });
});

describe("getMirrorViewForOwner", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createPgliteDb();
  });

  it("is null without a mirror", async () => {
    expect(await getMirrorViewForOwner("nobody", { db })).toBeNull();
  });

  it("renders a fresh mirror with nothing pending and Sync now available", async () => {
    const { owner, id } = await connected(db, { tools: "db-tools" });
    const view = await getMirrorViewForOwner(owner, { db });
    expect(view).toEqual({
      id,
      connected: true,
      parentPageId: PAGE,
      parentPageTitle: "Mirror",
      mapping: { tools: "db-tools" },
      paused: false,
      running: false,
      syncPending: false,
      pushScheduled: false,
      lastSyncedAt: null,
      lastRunAt: null,
      lastStatus: null,
      lastError: null,
      syncAvailableAt: null,
    });
    expect(JSON.stringify(view)).not.toMatch(/token/i);
  });

  it("computes running, syncPending, pushScheduled and syncAvailableAt in SQL, as ISO strings", async () => {
    const { owner, id } = await connected(db);
    await stage(
      db,
      id,
      `running_since = now(), sync_requested_at = '2099-01-01 00:00:00+00', push_requested_at = now(),
       last_synced_at = '2026-09-23 10:00:00.5+00', last_run_at = '2026-09-23 10:01:00+00', last_status = 'ok', paused_at = now()`
    );

    const view = (await getMirrorViewForOwner(owner, { db }))!;
    expect(view.running).toBe(true);
    expect(view.syncPending).toBe(true);
    expect(view.pushScheduled).toBe(true);
    expect(view.paused).toBe(true);
    expect(view.lastStatus).toBe("ok");
    expect(view.lastSyncedAt).toBe("2026-09-23T10:00:00.500Z");
    expect(view.lastRunAt).toBe("2026-09-23T10:01:00.000Z");
    expect(view.syncAvailableAt).toBe("2099-01-01T00:15:00.000Z");
  });

  it("treats a stale running_since as not running and an old Sync now as settled", async () => {
    const { owner, id } = await connected(db);
    await stage(
      db,
      id,
      "running_since = now() - interval '16 minutes', sync_requested_at = now() - interval '20 minutes', last_run_at = now() - interval '19 minutes'"
    );
    const view = (await getMirrorViewForOwner(owner, { db }))!;
    expect(view.running).toBe(false);
    expect(view.syncPending).toBe(false);
    expect(view.syncAvailableAt).toBeNull();
  });
});
