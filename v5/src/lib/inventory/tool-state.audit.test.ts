// @vitest-environment node
import { nextCacheMock } from "../../../test/mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());

// The one seam `tool-state.test.ts` cannot have: a database that answers the
// *second* statement with an error. `vi.hoisted` because the `vi.mock` factory
// runs before module scope exists.
const audit = vi.hoisted(() => ({ failing: false }));

vi.mock("../data/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../data/audit")>();
  return {
    ...actual,
    recordAuditEvent: async (event: Parameters<typeof actual.recordAuditEvent>[0]) => {
      if (audit.failing) throw new Error("connection terminated unexpectedly");
      return actual.recordAuditEvent(event);
    },
  };
});

import { revalidateTag } from "next/cache";

import { seedUser } from "../../../test/utils/session";
import { readToolRevision } from "../data/tools";
import { getDb, resetDbForTests } from "../db/client";
import { auditEvents, session, tools, user } from "../db/schema/index";
import type { Db } from "../db/types";
import { archiveTool, markReviewed, publishTool, restoreTool, unpublishTool } from "./tool-state";

/**
 * What happens when the state change lands and its audit event does not
 * (§4.11, Article 4).
 *
 * Its own file because it is the only one here that replaces `data/audit.ts`,
 * and a module mocked for one test in a file is mocked for all of them.
 *
 * **The property under test is that the panel is never told the change failed
 * when it did not.** Every island answers a refusal by restoring the previous
 * value, so an exception — or an `{ ok: false }` — here would leave the page
 * showing a draft over a database holding a published tool.
 */

let db: Db;
let actor: string;
let toolId: string;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.mocked(revalidateTag).mockClear();
  audit.failing = false;

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
  audit.failing = false;
  resetDbForTests();
});

async function change(
  apply: (input: { toolId: string; expectedRevision: string; actorUserId: string }) => Promise<unknown>
) {
  const expectedRevision = (await readToolRevision(toolId, { db }))!;
  return apply({ toolId, expectedRevision, actorUserId: actor });
}

async function readTool() {
  const [row] = await db.select().from(tools);
  return row;
}

describe.each([
  ["publish", publishTool, { published: true }],
  ["unpublish", unpublishTool, { published: false }],
  ["archive", archiveTool, { archived: true }],
  ["restore", restoreTool, { archived: false }],
] as const)("%s with the audit trail down", (_name, apply, expected) => {
  it("keeps the change and says the trail did not record it", async () => {
    // The row this change is about to move, so `published: false` → publish is
    // a real change and not a no-op.
    if ("published" in expected && expected.published === false) {
      await change(publishTool);
    }
    if ("archived" in expected && expected.archived === false) {
      await change(archiveTool);
    }
    await db.delete(auditEvents);

    audit.failing = true;
    const console_ = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await change(apply);

    expect(result).toEqual({ ok: true, revision: expect.any(String), warning: "audit_unavailable" });
    // The change is in the database. Answering `{ ok: false }` would make the
    // panel assert a state it no longer holds.
    const row = await readTool();
    if ("published" in expected) expect(row.published).toBe(expected.published);
    if ("archived" in expected) expect(row.archivedAt === null).toBe(!expected.archived);
    expect(await db.select().from(auditEvents)).toEqual([]);
    // The console line is the operator's copy — the only place the event exists.
    expect(console_).toHaveBeenCalledWith(
      "[inventory] audit write failed after the change landed",
      expect.any(Error)
    );
    // And the catalogue still has to be told, because the row really did change.
    expect(revalidateTag).toHaveBeenCalledWith("catalog", "minutes");

    console_.mockRestore();
  });
});

describe("markReviewed with the audit trail down", () => {
  it("is unaffected, because it writes no audit event at all", async () => {
    audit.failing = true;

    const result = await change(markReviewed);

    expect(result).toEqual({ ok: true, revision: expect.any(String) });
    expect((await readTool()).lastReviewedBy).toBe(actor);
  });
});
