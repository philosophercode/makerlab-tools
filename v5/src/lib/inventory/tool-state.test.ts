// @vitest-environment node
import { nextCacheMock } from "../../../test/mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());

import { sql } from "drizzle-orm";
import { revalidateTag } from "next/cache";

import { seedUser } from "../../../test/utils/session";
import { readToolRevision } from "../data/tools";
import { getDb, resetDbForTests } from "../db/client";
import { auditEvents, session, tools, user } from "../db/schema/index";
import type { Db } from "../db/types";
import { archiveTool, markReviewed, publishTool, restoreTool, unpublishTool } from "./tool-state";

/**
 * The five state changes, end to end: the row moves, the security-relevant ones
 * land in `audit_events`, and the catalogue cache is dropped (spec §5.3(5),
 * §4.11, §3.9).
 *
 * Against `getDb()` rather than an isolated handle, because `recordAuditEvent`
 * resolves its own — which is exactly what it does in production, and the only
 * way this file can assert on the trail it actually writes.
 */

let db: Db;
let actor: string;
let toolId: string;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.mocked(revalidateTag).mockClear();

  db = await getDb();
  await db.delete(auditEvents);
  await db.delete(tools);
  await db.delete(session);
  await db.delete(user);

  actor = (await seedUser({ email: "luis@cornell.edu", role: "admin" })).id;
  const [row] = await db
    .insert(tools)
    .values({ slug: "form-4", name: "Form 4", published: false })
    .returning({ id: tools.id });
  toolId = row.id;
});

afterEach(() => {
  resetDbForTests();
});

async function revision(): Promise<string> {
  return (await readToolRevision(toolId, { db }))!;
}

async function readTool() {
  const [row] = await db.select().from(tools);
  return row;
}

async function trail() {
  return db.select().from(auditEvents);
}

/** A stale token: the panel opened, somebody else saved, and this one did not. */
async function staleToken(): Promise<string> {
  const stale = await revision();
  // Staged rather than raced: PGlite's clock is millisecond-resolution, so a
  // second write inside the same millisecond would share a token.
  await db.execute(sql`alter table tools disable trigger tools_set_updated_at`);
  await db.execute(sql`update tools set updated_at = updated_at + interval '1 second'`);
  await db.execute(sql`alter table tools enable trigger tools_set_updated_at`);
  return stale;
}

describe("publishTool", () => {
  it("publishes, records it, and drops the catalogue cache", async () => {
    const result = await publishTool({ toolId, expectedRevision: await revision(), actorUserId: actor });

    expect(result).toEqual({ ok: true, revision: expect.any(String) });
    expect((await readTool()).published).toBe(true);
    expect(await trail()).toMatchObject([
      { action: "tool.published", subjectType: "tool", subjectId: toolId, actorUserId: actor },
    ]);
    // A save the catalogue does not show is the bug people actually report.
    expect(revalidateTag).toHaveBeenCalledWith("catalog", "minutes");
  });
});

describe("unpublishTool", () => {
  it("unpublishes and records it", async () => {
    await publishTool({ toolId, expectedRevision: await revision(), actorUserId: actor });

    const result = await unpublishTool({
      toolId,
      expectedRevision: await revision(),
      actorUserId: actor,
    });

    expect(result.ok).toBe(true);
    expect((await readTool()).published).toBe(false);
    expect((await trail()).map((e) => e.action)).toEqual(["tool.published", "tool.unpublished"]);
  });
});

describe("archiveTool and restoreTool", () => {
  it("archives without deleting, and records the archive", async () => {
    const result = await archiveTool({
      toolId,
      expectedRevision: await revision(),
      actorUserId: actor,
    });

    expect(result.ok).toBe(true);
    const row = await readTool();
    expect(row.archivedAt).toBeInstanceOf(Date);
    expect(row.name).toBe("Form 4");
    expect(await trail()).toMatchObject([
      { action: "tool.archived", detail: { archived: true } },
    ]);
  });

  it("restores as tool.archived with archived: false, because the vocabulary has no restore", async () => {
    await archiveTool({ toolId, expectedRevision: await revision(), actorUserId: actor });

    const result = await restoreTool({
      toolId,
      expectedRevision: await revision(),
      actorUserId: actor,
    });

    expect(result.ok).toBe(true);
    expect((await readTool()).archivedAt).toBeNull();
    // `AUDIT_ACTIONS` has no `tool.restored` (§4.11) — the same shape a lifted
    // ban already uses.
    expect((await trail()).map((e) => e.detail)).toEqual([{ archived: true }, { archived: false }]);
  });
});

describe("markReviewed", () => {
  it("stamps both columns and writes no audit event", async () => {
    const result = await markReviewed({
      toolId,
      expectedRevision: await revision(),
      actorUserId: actor,
    });

    expect(result.ok).toBe(true);
    const row = await readTool();
    expect(row.lastReviewedAt).toBeInstanceOf(Date);
    expect(row.lastReviewedBy).toBe(actor);
    // Deliberate: §4.11 scopes the trail to security-relevant actions and has no
    // entry for a review. See the docstring on `markReviewed`.
    expect(await trail()).toEqual([]);
    expect(revalidateTag).toHaveBeenCalledWith("catalog", "minutes");
  });
});

describe("a stale token", () => {
  it("refuses every one of the five, writes nothing, and busts no cache", async () => {
    const stale = await staleToken();
    const input = { toolId, expectedRevision: stale, actorUserId: actor };

    for (const change of [publishTool, unpublishTool, archiveTool, restoreTool, markReviewed]) {
      expect(await change(input)).toEqual({ ok: false, error: "conflict" });
    }

    expect(await readTool()).toMatchObject({
      published: false,
      archivedAt: null,
      lastReviewedAt: null,
    });
    expect(await trail()).toEqual([]);
    // Nothing changed, so there is nothing stale to bust — and busting costs a
    // full catalogue re-read on the next request.
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("reports an unknown tool as not_found, not as a conflict", async () => {
    const result = await publishTool({
      toolId: crypto.randomUUID(),
      expectedRevision: "1",
      actorUserId: actor,
    });
    expect(result).toEqual({ ok: false, error: "not_found" });
  });
});
