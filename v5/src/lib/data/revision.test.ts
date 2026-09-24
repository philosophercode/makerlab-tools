// @vitest-environment node
import { and, eq, sql } from "drizzle-orm";
import { createPgliteDb } from "../db/pglite";
import { tools } from "../db/schema/index";
import type { Db } from "../db/types";
import { revisionEquals, revisionOf } from "./revision";

/**
 * The concurrency token, against a real (in-process) Postgres.
 *
 * **This file exists because the obvious implementation passes.** PGlite's
 * `now()` is millisecond-resolution, so a `Date` round trip is lossless here
 * and `where updated_at = <the Date we read>` matches — forever, in every test
 * anybody writes. Real Postgres `now()` is microsecond-resolution, so the same
 * comparison matches nothing on Neon and every save reports a conflict that did
 * not happen.
 *
 * So the microsecond value is *staged*: the `set_updated_at()` trigger is
 * turned off, a timestamp with microseconds is written directly, and the
 * trigger goes back on. That makes the production failure reproducible with no
 * credential and no network, which is the only way this bug gets caught before
 * a deploy.
 */

let db: Db;

/** A `timestamptz` with microseconds — what `now()` gives on real Postgres. */
const MICROSECOND_STAMP = "2026-01-01 10:00:00.123456+00";

/** What a driver that truncates to milliseconds hands back for it. */
const TRUNCATED_ISO = "2026-01-01T10:00:00.123Z";

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  await db.delete(tools);
});

async function insertTool(): Promise<string> {
  const [row] = await db
    .insert(tools)
    .values({ slug: `t-${crypto.randomUUID()}`, name: "Form 4" })
    .returning({ id: tools.id });
  return row.id;
}

/**
 * Write `updated_at` exactly, past the trigger that would otherwise overwrite
 * it with `now()`. The only way to hold a microsecond timestamp on a substrate
 * whose clock has none.
 */
async function stageUpdatedAt(id: string, stamp: string): Promise<void> {
  await db.execute(sql`alter table tools disable trigger tools_set_updated_at`);
  await db.execute(sql`update tools set updated_at = ${sql.raw(`timestamptz '${stamp}'`)} where id = ${id}`);
  await db.execute(sql`alter table tools enable trigger tools_set_updated_at`);
}

async function readRevision(id: string): Promise<string> {
  const [row] = await db
    .select({ revision: revisionOf(tools.updatedAt) })
    .from(tools)
    .where(eq(tools.id, id));
  return row.revision;
}

describe("the revision token", () => {
  it("matches a row whose updated_at has microseconds the driver cannot hold", async () => {
    const id = await insertTool();
    await stageUpdatedAt(id, MICROSECOND_STAMP);

    const revision = await readRevision(id);

    const matched = await db
      .select({ id: tools.id })
      .from(tools)
      .where(and(eq(tools.id, id), revisionEquals(tools.updatedAt, revision)));

    expect(matched).toHaveLength(1);
  });

  it("is what a Date comparison is not: the Date read back has already lost the microseconds", async () => {
    const id = await insertTool();
    await stageUpdatedAt(id, MICROSECOND_STAMP);

    // This is the value the panel would have carried under the naive design.
    const [row] = await db
      .select({ updatedAt: tools.updatedAt })
      .from(tools)
      .where(eq(tools.id, id));
    expect(row.updatedAt.toISOString()).toBe(TRUNCATED_ISO);

    // And this is the save that would have reported "somebody else changed this
    // tool" on every single attempt, on Neon, in production.
    const matched = await db
      .select({ id: tools.id })
      .from(tools)
      .where(and(eq(tools.id, id), eq(tools.updatedAt, row.updatedAt)));

    expect(matched).toHaveLength(0);
  });

  it("stops matching once the row moves", async () => {
    const id = await insertTool();
    await stageUpdatedAt(id, MICROSECOND_STAMP);
    const stale = await readRevision(id);

    await stageUpdatedAt(id, "2026-01-01 10:00:00.123999+00");

    const matched = await db
      .select({ id: tools.id })
      .from(tools)
      .where(and(eq(tools.id, id), revisionEquals(tools.updatedAt, stale)));

    // A single microsecond apart — the whole difference the millisecond token
    // could not see.
    expect(matched).toHaveLength(0);
  });

  it("is minted and compared by one expression, so an ordinary write round trips", async () => {
    const id = await insertTool();
    const revision = await readRevision(id);

    const moved = await db
      .update(tools)
      .set({ name: "Form 4 (moved)" })
      .where(and(eq(tools.id, id), revisionEquals(tools.updatedAt, revision)))
      .returning({ revision: revisionOf(tools.updatedAt) });

    expect(moved).toHaveLength(1);
    // The token in `returning` is the post-trigger one, so a caller saving
    // twice never has to re-read to stay current.
    expect(moved[0].revision).toBe(await readRevision(id));
  });
});
