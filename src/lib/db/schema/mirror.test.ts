// @vitest-environment node
import { eq, sql } from "drizzle-orm";
import { expectViolation } from "../../../../test/db";
import { createPgliteDb } from "../pglite";
import { rawRows } from "../raw";
import { user } from "./auth";
import { byteaToUint8Array, mirrorPages, notionMirrors } from "./mirror";
import type { Db } from "../types";

/**
 * Migration `0007` against a real (in-process) Postgres (spec §4.12). Each
 * assertion is something only the database can get wrong: a CHECK, a unique
 * owner, two cascades, a byte-exact bytea and the hand-appended trigger.
 */
describe("notion_mirrors and mirror_pages", () => {
  let db: Db;

  beforeAll(async () => {
    db = await createPgliteDb();
  });

  async function insertUser(): Promise<string> {
    const id = `u-${Math.random().toString(36).slice(2)}`;
    await db.insert(user).values({ id, name: "Mirror Owner", email: `${id}@cornell.edu` });
    return id;
  }

  async function insertMirror(ownerUserId: string, overrides: Partial<typeof notionMirrors.$inferInsert> = {}) {
    const [row] = await db
      .insert(notionMirrors)
      .values({ ownerUserId, parentPageId: "0f5e4a3c-1111-2222-3333-444455556666", ...overrides })
      .returning();
    return row;
  }

  it("defaults the mapping to an empty object and the token to disconnected", async () => {
    const row = await insertMirror(await insertUser());
    expect(row.mapping).toEqual({});
    expect(row.mappingGeneration).toBe(0);
    expect(row.tokenCiphertext).toBeNull();
    expect(row.lastStatus).toBeNull();
  });

  it("refuses a status outside the vocabulary", async () => {
    const owner = await insertUser();
    await expectViolation(
      insertMirror(owner, { lastStatus: "OK" }),
      /notion_mirrors_last_status_check/
    );
  });

  it("refuses an entity outside the vocabulary", async () => {
    const mirror = await insertMirror(await insertUser());
    await expectViolation(
      db.insert(mirrorPages).values({
        mirrorId: mirror.id,
        entity: "maintenance_logs",
        entityId: crypto.randomUUID(),
        notionPageId: "page-1",
      }),
      /mirror_pages_entity_check/
    );
  });

  it("allows one mirror per owner", async () => {
    const owner = await insertUser();
    await insertMirror(owner);
    await expectViolation(insertMirror(owner), /notion_mirrors_owner_user_id_unique/);
  });

  it("keys a page on (mirror, entity, entity id)", async () => {
    const mirror = await insertMirror(await insertUser());
    const entityId = crypto.randomUUID();
    await db.insert(mirrorPages).values({ mirrorId: mirror.id, entity: "tools", entityId, notionPageId: "p-1" });
    // The same row under another entity is a different page.
    await db.insert(mirrorPages).values({ mirrorId: mirror.id, entity: "units", entityId, notionPageId: "p-2" });
    await expectViolation(
      db.insert(mirrorPages).values({ mirrorId: mirror.id, entity: "tools", entityId, notionPageId: "p-3" }),
      /mirror_pages_mirror_id_entity_entity_id_pk/
    );
  });

  it("deletes a mirror's pages with the mirror", async () => {
    const mirror = await insertMirror(await insertUser());
    await db.insert(mirrorPages).values({
      mirrorId: mirror.id,
      entity: "tools",
      entityId: crypto.randomUUID(),
      notionPageId: "p-1",
    });

    await db.delete(notionMirrors).where(eq(notionMirrors.id, mirror.id));

    const left = await db.select().from(mirrorPages).where(eq(mirrorPages.mirrorId, mirror.id));
    expect(left).toHaveLength(0);
  });

  it("deletes the mirror, and its token, with its owner", async () => {
    const owner = await insertUser();
    const mirror = await insertMirror(owner, { tokenCiphertext: new Uint8Array([1, 2, 3]) });

    await db.delete(user).where(eq(user.id, owner));

    const left = await db.select().from(notionMirrors).where(eq(notionMirrors.id, mirror.id));
    expect(left).toHaveLength(0);
  });

  it("round-trips a bytea byte for byte", async () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = i;
    const mirror = await insertMirror(await insertUser(), { tokenCiphertext: bytes });

    const [read] = await db
      .select({ token: notionMirrors.tokenCiphertext })
      .from(notionMirrors)
      .where(eq(notionMirrors.id, mirror.id));
    expect(read.token).toBeInstanceOf(Uint8Array);
    expect(Array.from(read.token as Uint8Array)).toEqual(Array.from(bytes));

    const [length] = await rawRows<{ n: number }>(
      db,
      sql`select octet_length(token_ciphertext) as n from notion_mirrors where id = ${mirror.id}`
    );
    expect(Number(length.n)).toBe(256);
  });

  it("maintains updated_at from the trigger", async () => {
    const mirror = await insertMirror(await insertUser());

    await new Promise((resolve) => setTimeout(resolve, 5));
    await db.update(notionMirrors).set({ parentPageTitle: "MakerLab Tools — mirror" }).where(eq(notionMirrors.id, mirror.id));

    const [after] = await db.select().from(notionMirrors).where(eq(notionMirrors.id, mirror.id));
    expect(after.updatedAt.getTime()).toBeGreaterThan(mirror.updatedAt.getTime());

    const triggers = await rawRows<{ tgname: string }>(
      db,
      sql`select tgname from pg_trigger where tgname = 'notion_mirrors_set_updated_at'`
    );
    expect(triggers).toHaveLength(1);
  });
});

describe("byteaToUint8Array", () => {
  it("normalises every shape a driver may return", () => {
    expect(Array.from(byteaToUint8Array(new Uint8Array([1, 255])))).toEqual([1, 255]);
    expect(Array.from(byteaToUint8Array(Buffer.from([1, 255])))).toEqual([1, 255]);
    expect(Array.from(byteaToUint8Array("\\x01ff"))).toEqual([1, 255]);
    expect(Array.from(byteaToUint8Array(new Uint8Array([9, 1, 255]).subarray(1)))).toEqual([1, 255]);
  });

  it("refuses what is not bytes", () => {
    expect(() => byteaToUint8Array("\\xzz")).toThrow(TypeError);
    expect(() => byteaToUint8Array(42)).toThrow(TypeError);
  });
});
