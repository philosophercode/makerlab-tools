// @vitest-environment node
import { eq, sql } from "drizzle-orm";
import { insertUserRow } from "../../../test/utils/session";
import { createPgliteDb } from "../db/pglite";
import { categories, tools, user } from "../db/schema/index";
import type { Db } from "../db/types";
import {
  findToolForEditor,
  markToolReviewed,
  readToolRevision,
  setToolArchived,
  setToolPublished,
  touchTool,
  updateTool,
} from "./tools";

/**
 * Tool writes against a real (in-process) Postgres — above all the
 * optimistic-concurrency check §5.3(4) turns on, which is the difference
 * between two people editing a tool and one of them losing their work without
 * being told.
 */

let db: Db;
let actor: string;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  await db.delete(tools);
  await db.delete(categories);
  await db.delete(user);
  // `updated_by` is a real foreign key since Phase 4: a write whose author is
  // not a row is refused.
  actor = (await insertUserRow(db, { email: "luis@cornell.edu", role: "admin" })).id;
});

async function insertTool(
  values: Partial<typeof tools.$inferInsert> = {}
): Promise<string> {
  const [row] = await db
    .insert(tools)
    .values({ slug: `form-4-${crypto.randomUUID()}`, name: "Form 4", ...values })
    .returning({ id: tools.id });
  return row.id;
}

async function readTool(id: string) {
  const [row] = await db.select().from(tools).where(eq(tools.id, id));
  return row;
}

/**
 * Move `updated_at` by hand, past the trigger.
 *
 * PGlite's clock is millisecond-resolution, so two writes inside the same
 * millisecond would share a token and a conflict test could pass — or fail —
 * for the wrong reason. Staging the timestamp makes every move here
 * deterministic. (Real Postgres has microseconds and no such window; see
 * `./revision.test.ts`.)
 */
async function bumpUpdatedAt(id: string, to = "updated_at + interval '1 second'"): Promise<void> {
  await db.execute(sql`alter table tools disable trigger tools_set_updated_at`);
  await db.execute(
    sql`update tools set updated_at = ${sql.raw(to)} where id = ${id}`
  );
  await db.execute(sql`alter table tools enable trigger tools_set_updated_at`);
}

/** Somebody else's edit, landing while our panel is open. */
async function otherWriterEdits(id: string, name: string): Promise<void> {
  const revision = await readToolRevision(id, { db });
  const written = await updateTool(id, { name }, revision!, { db });
  expect(written.ok).toBe(true);
  await bumpUpdatedAt(id);
}

describe("findToolForEditor", () => {
  it("finds a draft by slug, with the token its save will carry", async () => {
    const id = await insertTool({ slug: "form-4", published: false });

    const tool = await findToolForEditor("form-4", { db });

    expect(tool).toMatchObject({ id, name: "Form 4", published: false });
    // The catalogue would not have shown this row at all; the editor's job is
    // exactly the rows the catalogue hides.
    expect(tool?.revision).toBe(await readToolRevision(id, { db }));
  });

  it("finds an archived tool by uuid, and answers null for anything else", async () => {
    const id = await insertTool({ archivedAt: new Date("2026-01-01T00:00:00Z") });

    expect(await findToolForEditor(id, { db })).toMatchObject({ id });
    expect(await findToolForEditor("not-a-tool", { db })).toBeNull();
  });
});

describe("updateTool", () => {
  it("writes the patch, stamps the author and hands back the next token", async () => {
    const id = await insertTool();
    const before = await findToolForEditor(id, { db });

    const written = await updateTool(
      id,
      { description: "  A resin printer.  ", tags: ["resin", " sla "] },
      before!.revision,
      { db, actorUserId: actor }
    );

    expect(written).toEqual({ ok: true, revision: expect.any(String) });
    const row = await readTool(id);
    expect(row.description).toBe("A resin printer.");
    expect(row.tags).toEqual(["resin", "sla"]);
    expect(row.updatedBy).toBe(actor);
    // The token in `returning` is the post-trigger one.
    expect(written.ok && written.revision).toBe(await readToolRevision(id, { db }));
  });

  it("leaves untouched fields alone rather than blanking them", async () => {
    const id = await insertTool({ description: "kept", notes: "also kept" });
    const revision = await readToolRevision(id, { db });

    await updateTool(id, { name: "Form 4B" }, revision!, { db, actorUserId: actor });

    const row = await readTool(id);
    expect(row).toMatchObject({ name: "Form 4B", description: "kept", notes: "also kept" });
  });

  it("refuses a stale token, writes nothing, and keeps the other writer's value", async () => {
    const id = await insertTool();
    // Two panels open on the same tool.
    const stale = (await findToolForEditor(id, { db }))!.revision;
    await otherWriterEdits(id, "Form 4 — renamed by Niti");

    const written = await updateTool(id, { name: "Form 4 — renamed by Luis" }, stale, {
      db,
      actorUserId: actor,
    });

    expect(written).toEqual({ ok: false, reason: "conflict" });
    expect((await readTool(id)).name).toBe("Form 4 — renamed by Niti");
  });

  it("tells an unknown tool apart from a conflict", async () => {
    const written = await updateTool(crypto.randomUUID(), { name: "Ghost" }, "1", { db });
    expect(written).toEqual({ ok: false, reason: "not_found" });

    // And a slug, which would reach a uuid column as a cast error.
    expect(await updateTool("form-4", { name: "Ghost" }, "1", { db })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("refuses a value the column would take but the catalogue could not use", async () => {
    const id = await insertTool({ name: "Form 4" });
    const revision = await readToolRevision(id, { db });

    for (const patch of [{ name: "   " }, { categoryId: "not-a-uuid" }]) {
      expect(await updateTool(id, patch, revision!, { db })).toEqual({
        ok: false,
        reason: "invalid_field",
      });
    }
    // Nothing was written, so the token the panel holds is still good.
    expect(await readToolRevision(id, { db })).toBe(revision);
    expect((await readTool(id)).name).toBe("Form 4");
  });
});

describe("touchTool", () => {
  it("moves the revision without changing a field", async () => {
    const id = await insertTool({ description: "unchanged" });
    // A no-op UPDATE still fires the trigger — that is the property under test —
    // so the row is staged into the past first and the touch has to drag it back.
    await bumpUpdatedAt(id, "timestamptz '2020-01-01 00:00:00+00'");
    const staged = await readToolRevision(id, { db });

    const touched = await touchTool(db, id, staged!, actor);

    expect(touched.ok).toBe(true);
    expect(touched.ok && touched.revision).not.toBe(staged);
    expect((await readTool(id)).description).toBe("unchanged");
  });

  it("refuses a stale token, so a child write can roll itself back", async () => {
    const id = await insertTool();
    const stale = await readToolRevision(id, { db });
    await otherWriterEdits(id, "moved");

    expect(await touchTool(db, id, stale!, actor)).toEqual({ ok: false, reason: "conflict" });
  });
});

describe("state changes", () => {
  it("publishes and unpublishes", async () => {
    const id = await insertTool({ published: false });

    const published = await setToolPublished(id, true, (await readToolRevision(id, { db }))!, {
      db,
      actorUserId: actor,
    });
    expect(published.ok).toBe(true);
    expect((await readTool(id)).published).toBe(true);

    await setToolPublished(id, false, (await readToolRevision(id, { db }))!, { db });
    expect((await readTool(id)).published).toBe(false);
  });

  it("archives without deleting, and restores", async () => {
    const id = await insertTool();

    await setToolArchived(id, true, (await readToolRevision(id, { db }))!, {
      db,
      actorUserId: actor,
    });
    const archived = await readTool(id);
    expect(archived.archivedAt).toBeInstanceOf(Date);
    // The row is still there — history, project links and QR labels point at it.
    expect(archived.name).toBe("Form 4");

    await setToolArchived(id, false, (await readToolRevision(id, { db }))!, { db });
    expect((await readTool(id)).archivedAt).toBeNull();
  });

  it("marks a tool reviewed with both columns together", async () => {
    const id = await insertTool();

    await markToolReviewed(id, (await readToolRevision(id, { db }))!, {
      db,
      actorUserId: actor,
    });

    const row = await readTool(id);
    expect(row.lastReviewedAt).toBeInstanceOf(Date);
    // A date with no reviewer is an assertion nobody signed.
    expect(row.lastReviewedBy).toBe(actor);
  });

  it("refuses every state change on a stale token", async () => {
    const id = await insertTool();
    const stale = (await readToolRevision(id, { db }))!;
    await otherWriterEdits(id, "moved");

    expect(await setToolPublished(id, true, stale, { db })).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(await setToolArchived(id, true, stale, { db })).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(await markToolReviewed(id, stale, { db })).toEqual({ ok: false, reason: "conflict" });

    const row = await readTool(id);
    expect(row).toMatchObject({ published: false, archivedAt: null, lastReviewedAt: null });
  });
});

describe("inside one transaction", () => {
  it("gives every write the same updated_at, so one token describes all of them", async () => {
    const first = await insertTool({ slug: "a" });
    const second = await insertTool({ slug: "b" });

    // `now()` is transaction-start time, so two writes in one transaction share
    // a timestamp — which is what makes a multi-table panel save return one
    // token that is true of the whole save.
    const [one, two] = await db.transaction(async (tx) => {
      const a = await touchTool(tx, first, (await readToolRevision(first, { db: tx }))!, actor);
      const b = await touchTool(tx, second, (await readToolRevision(second, { db: tx }))!, actor);
      return [a, b];
    });

    expect(one.ok && two.ok && one.revision).toBe(two.ok && two.revision);
  });
});
