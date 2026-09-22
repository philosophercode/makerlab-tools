// @vitest-environment node
import { nextCacheMock } from "../../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { resetAuthForTests } from "../../../lib/auth/config";
import { listAuditEvents } from "../../../lib/data/audit";
import { readToolRevision } from "../../../lib/data/tools";
import { getDb, resetDbForTests } from "../../../lib/db/client";
import { auditEvents, session, tools, units, user } from "../../../lib/db/schema/index";
import type { Db } from "../../../lib/db/types";
import { signInAsNew } from "../../../../test/utils/session";
import {
  archive,
  loadToolForEditor,
  markToolReviewed,
  publish,
  restore,
  saveTool,
  unpublish,
} from "./actions";

/**
 * The tool editor's server actions, called **directly** — which is the whole
 * point (spec §8). A server action is a POST endpoint with a generated name:
 * reaching it needs no page, no panel and no control, so the gate on each
 * action is the only thing standing in front of the write.
 *
 * Everything is real here except the two Next modules that need a request
 * scope: PGlite, real session rows, the real audit table. No network, no
 * Google, no `DATABASE_URL` (Article 3).
 */

const AUTH_SECRET = "inventory-actions-test-secret";

let db: Db;
let toolId: string;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();
  vi.mocked(revalidatePath).mockClear();

  db = await getDb();
  await db.delete(auditEvents);
  await db.delete(units);
  await db.delete(tools);
  await db.delete(session);
  await db.delete(user);

  const [row] = await db
    .insert(tools)
    .values({ slug: "form-4", name: "Form 4", description: "before", published: false })
    .returning({ id: tools.id });
  toolId = row.id;
});

afterEach(() => {
  resetAuthForTests();
  resetDbForTests();
});

/** Sign in as a SuperMaker and point `next/headers` at their cookie. */
async function asSuperMaker(email = "maker@cornell.edu") {
  const signedIn = await signInAsNew({ email, role: "admin", name: "Luis" });
  setMockHeaders({ cookie: signedIn.cookie });
  return signedIn;
}

async function asStudent(email = "student@cornell.edu") {
  const signedIn = await signInAsNew({ email, role: "user" });
  setMockHeaders({ cookie: signedIn.cookie });
  return signedIn;
}

async function revision(): Promise<string> {
  return (await readToolRevision(toolId))!;
}

async function toolRow() {
  return (await db.select().from(tools).where(eq(tools.id, toolId)))[0];
}

// ── Who may call these at all (§8) ──────────────────────────────────

describe("the permission gate", () => {
  it("refuses an anonymous caller on every action, and writes nothing", async () => {
    setMockHeaders();
    const input = { toolId, expectedRevision: await revision() };

    expect(await loadToolForEditor("form-4")).toEqual({ ok: false, error: "not_signed_in" });
    expect(await saveTool({ ...input, patch: { description: "after" } })).toEqual({
      ok: false,
      error: "not_signed_in",
    });
    expect(await publish(input)).toEqual({ ok: false, error: "not_signed_in" });
    expect(await archive(input)).toEqual({ ok: false, error: "not_signed_in" });
    expect(await markToolReviewed(input)).toEqual({ ok: false, error: "not_signed_in" });

    const row = await toolRow();
    expect(row.description).toBe("before");
    expect(row.published).toBe(false);
    expect(row.archivedAt).toBeNull();
  });

  it("refuses a signed-in student, who holds neither permission", async () => {
    await asStudent();
    const input = { toolId, expectedRevision: await revision() };

    // Told apart from `not_signed_in`: signing in again would not help.
    expect(await loadToolForEditor("form-4")).toEqual({ ok: false, error: "not_permitted" });
    expect(await saveTool({ ...input, patch: { name: "Renamed" } })).toEqual({
      ok: false,
      error: "not_permitted",
    });
    expect(await publish(input)).toEqual({ ok: false, error: "not_permitted" });
    expect((await toolRow()).name).toBe("Form 4");
  });

  it("never lets a refused caller read a draft through the editor", async () => {
    // The load is a reader and still a POST endpoint: it sees drafts, archived
    // tools and unpublished resources, so it gates itself like every write.
    await asStudent();
    expect(await loadToolForEditor("form-4")).toEqual({ ok: false, error: "not_permitted" });
  });
});

// ── Opening the panel (§5.3(3)) ─────────────────────────────────────

describe("loadToolForEditor", () => {
  it("returns the draft, its children and the taxonomy the form selects from", async () => {
    await asSuperMaker();
    await db.insert(units).values({ toolId, unitLabel: "Form 4 #1" });

    const result = await loadToolForEditor("form-4");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.editor.tool.name).toBe("Form 4");
    expect(result.editor.units.map((unit) => unit.unitLabel)).toEqual(["Form 4 #1"]);
    expect(Array.isArray(result.editor.categories)).toBe(true);
    expect(Array.isArray(result.editor.locations)).toBe(true);
  });

  it("mints a token that a save made straight afterwards accepts", async () => {
    await asSuperMaker();
    const result = await loadToolForEditor("form-4");
    if (!result.ok) throw new Error("expected the panel to open");

    const saved = await saveTool({
      toolId,
      expectedRevision: result.editor.tool.revision,
      patch: { description: "after" },
    });
    expect(saved.ok).toBe(true);
    expect((await toolRow()).description).toBe("after");
  });

  it("says not_found for a slug nobody owns", async () => {
    await asSuperMaker();
    expect(await loadToolForEditor("no-such-tool")).toEqual({ ok: false, error: "not_found" });
  });
});

// ── Saving (§5.3(4)) ────────────────────────────────────────────────

describe("saveTool", () => {
  it("writes the patch, stamps the author and hands back a fresh token", async () => {
    const maker = await asSuperMaker();
    const before = await revision();

    const result = await saveTool({
      toolId,
      expectedRevision: before,
      patch: { description: "after" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The token it came in with is spent; without a new one the panel's next
    // save would conflict with itself.
    expect(result.revision).not.toBe(before);

    const row = await toolRow();
    expect(row.description).toBe("after");
    expect(row.updatedBy).toBe(maker.user.id);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/inventory");
  });

  it("refuses a value the catalogue could not render, and changes nothing", async () => {
    await asSuperMaker();
    expect(
      await saveTool({ toolId, expectedRevision: await revision(), patch: { name: "   " } })
    ).toEqual({ ok: false, error: "invalid_field" });
    expect((await toolRow()).name).toBe("Form 4");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

// ── State changes (§5.3(5), §4.11) ──────────────────────────────────

describe("the state changes", () => {
  it("publishes, and records who did it", async () => {
    const maker = await asSuperMaker();

    const result = await publish({ toolId, expectedRevision: await revision() });
    expect(result.ok).toBe(true);
    expect((await toolRow()).published).toBe(true);

    const events = await listAuditEvents();
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe("tool.published");
    expect(events[0].subjectId).toBe(toolId);
    expect(events[0].actorUserId).toBe(maker.user.id);
  });

  it("unpublishes, and records that separately", async () => {
    await asSuperMaker();
    await publish({ toolId, expectedRevision: await revision() });

    await unpublish({ toolId, expectedRevision: await revision() });
    expect((await toolRow()).published).toBe(false);
    expect((await listAuditEvents()).map((event) => event.action)).toEqual([
      "tool.unpublished",
      "tool.published",
    ]);
  });

  it("archives without deleting, and restores as the same action with a flag", async () => {
    await asSuperMaker();

    await archive({ toolId, expectedRevision: await revision() });
    expect((await toolRow()).archivedAt).not.toBeNull();

    await restore({ toolId, expectedRevision: await revision() });
    expect((await toolRow()).archivedAt).toBeNull();

    // `AUDIT_ACTIONS` has no `tool.restored` (§4.11), so a restore is
    // `tool.archived` with `archived: false` — the shape a lifted ban uses.
    const events = await listAuditEvents();
    expect(events.map((event) => event.action)).toEqual(["tool.archived", "tool.archived"]);
    expect(events.map((event) => (event.detail as { archived: boolean }).archived)).toEqual([
      false,
      true,
    ]);
  });

  it("marks a tool reviewed with both columns, and records nothing", async () => {
    const maker = await asSuperMaker();

    expect((await markToolReviewed({ toolId, expectedRevision: await revision() })).ok).toBe(true);

    const row = await toolRow();
    expect(row.lastReviewedAt).not.toBeNull();
    expect(row.lastReviewedBy).toBe(maker.user.id);
    // A review is an ordinary edit, and §4.11 says those are not logged.
    expect(await listAuditEvents()).toEqual([]);
  });

  it("refuses a state change on a tool that is gone, and records nothing", async () => {
    await asSuperMaker();
    const stale = await revision();
    await db.delete(tools).where(eq(tools.id, toolId));

    expect(await publish({ toolId, expectedRevision: stale })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await listAuditEvents()).toEqual([]);
  });
});
