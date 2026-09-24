// @vitest-environment node
import { nextCacheMock } from "../../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());
vi.mock("workflow/api", () => ({ start: vi.fn(async () => ({ runId: "run-1" })) }));
vi.mock("../../../lib/mirror/trigger", () => ({ requestMirrorPush: vi.fn(async () => undefined) }));
vi.mock("../../../lib/manuals/trigger", () => ({ requestManualArchive: vi.fn(async () => undefined) }));

/** Withhold one permission, to prove each action asks for its own (as the other queues' tests do). */
const override = vi.hoisted(() => ({ permissions: null as Set<string> | null }));

vi.mock("../../../lib/auth/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/auth/permissions")>();
  return {
    ...actual,
    can: (subject: Parameters<typeof actual.can>[0], permission: string) =>
      override.permissions
        ? override.permissions.has(permission)
        : actual.can(subject, permission as Parameters<typeof actual.can>[1]),
  };
});

import { eq } from "drizzle-orm";
import { start } from "workflow/api";
import { resetAuthForTests } from "../../../lib/auth/config";
import { claimRefresh, completeRefresh, getRefresh, getRefreshRowRevision, listRefreshesForTool } from "../../../lib/data/tool-refreshes";
import { getDb, resetDbForTests } from "../../../lib/db/client";
import { researchRequests, session, toolRefreshes, tools } from "../../../lib/db/schema/index";
import type { Db } from "../../../lib/db/types";
import { researchFixture } from "../../../lib/refresh/fixtures.test-helpers";
import type { FieldProposal } from "../../../lib/refresh/types";
import { signInAsNew } from "../../../../test/utils/session";
import { decideRefreshProposals, queueToolRefresh, refreshAgain } from "./actions";

/**
 * Refresh research's endpoints (refresh research spec §5, §8): called directly,
 * with no page, because a server action is a POST endpoint with a generated
 * name. Who may call each, that refusals are values, and the note rules.
 */

let db: Db;
let toolId: string;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "admin-refresh-test-secret");
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();
  override.permissions = null;
  vi.mocked(start).mockClear();
  db = await getDb();
  await db.delete(researchRequests);
  await db.delete(toolRefreshes);
  await db.delete(session);
  const [tool] = await db
    .insert(tools)
    .values({ slug: `refresh-action-${crypto.randomUUID().slice(0, 6)}`, name: "WEN air filter", useRestrictions: "1 micron.", published: true })
    .returning({ id: tools.id });
  toolId = tool.id;
});

afterEach(() => {
  override.permissions = null;
  resetAuthForTests();
  resetDbForTests();
});

async function asSuperMaker() {
  const signedIn = await signInAsNew({ email: `niti-${crypto.randomUUID().slice(0, 6)}@cornell.edu`, role: "admin" });
  setMockHeaders({ cookie: signedIn.cookie });
  return signedIn;
}

it("refuses an anonymous caller and a student, and queues nothing", async () => {
  setMockHeaders();
  expect(await queueToolRefresh({ toolIds: [toolId], includeDescription: false, note: null })).toEqual({ ok: false, error: "not_signed_in" });
  const student = await signInAsNew({ email: "casey@cornell.edu", role: "user" });
  setMockHeaders({ cookie: student.cookie });
  expect(await queueToolRefresh({ toolIds: [toolId], includeDescription: false, note: null })).toEqual({ ok: false, error: "not_permitted" });
  expect(await db.select().from(toolRefreshes)).toHaveLength(0);
});

it("asks for tools.edit, not an adjacent permission", async () => {
  await asSuperMaker();
  override.permissions = new Set(["tools.approve", "tools.add", "feedback.manage"]);
  expect(await queueToolRefresh({ toolIds: [toolId], includeDescription: false, note: null })).toEqual({ ok: false, error: "not_permitted" });
  override.permissions = new Set(["tools.edit"]);
  expect(await queueToolRefresh({ toolIds: [toolId], includeDescription: false, note: null })).toMatchObject({ ok: true, queued: 1 });
});

it("queues and starts a run; a note goes with one tool only", async () => {
  await asSuperMaker();
  const [other] = await db.insert(tools).values({ slug: `other-${crypto.randomUUID().slice(0, 6)}`, name: "Other" }).returning({ id: tools.id });
  expect(await queueToolRefresh({ toolIds: [toolId, other.id], includeDescription: false, note: "the 80 W model" })).toEqual({
    ok: false,
    error: "invalid_field",
  });
  expect(await queueToolRefresh({ toolIds: [toolId], includeDescription: true, note: "the 80 W model" })).toEqual({
    ok: true,
    queued: 1,
    skipped: 0,
    missing: 0,
  });
  expect(start).toHaveBeenCalledTimes(1);
  const [refresh] = await listRefreshesForTool(toolId);
  expect(refresh).toMatchObject({ note: "the 80 W model", includeDescription: true, status: "queued" });
});

it("decides proposals, and Refresh again closes the refresh and queues a new one", async () => {
  await asSuperMaker();
  await queueToolRefresh({ toolIds: [toolId], includeDescription: false, note: null });
  const [queued] = await listRefreshesForTool(toolId);
  await claimRefresh(queued.id, queued.requestId);
  const proposals: FieldProposal[] = [
    {
      id: "use_restrictions",
      field: "use_restrictions",
      kind: "differs",
      safety: true,
      current: "1 micron.",
      proposed: "5 microns.",
      citations: [{ quote: "Filters to 5 microns", url: "https://a.example/", verified: true }],
      decision: "pending",
    },
    { id: "tags", field: "tags", kind: "new", safety: false, current: [], proposed: ["Dust"], citations: [], decision: "pending" },
  ];
  await completeRefresh(queued.id, queued.requestId, researchFixture(), proposals);

  const rowRevision = (await getRefreshRowRevision(queued.id))!;
  expect(await decideRefreshProposals({ refreshId: queued.id, rowRevision, decision: "accept", ids: ["use_restrictions"] })).toEqual({
    ok: true,
    applied: 1,
  });
  const [row] = await db.select().from(tools).where(eq(tools.id, toolId));
  expect(row.useRestrictions).toBe("5 microns.");
  // The page's revision is spent: an action against it is told to reload.
  expect(await decideRefreshProposals({ refreshId: queued.id, rowRevision, decision: "reject_all" })).toEqual({
    ok: false,
    error: "stale_refresh",
  });

  expect(await refreshAgain({ refreshId: queued.id, note: "check the manual", includeDescription: false })).toMatchObject({ ok: true, queued: 1 });
  expect((await getRefresh(queued.id))?.status).toBe("decided");
  const refreshes = await listRefreshesForTool(toolId);
  expect(refreshes[0]).toMatchObject({ status: "queued", note: "check the manual" });
});

it("refuses a decision body that does not parse", async () => {
  await asSuperMaker();
  expect(
    await decideRefreshProposals({ refreshId: "nope", rowRevision: "1", decision: "accept" } as Parameters<typeof decideRefreshProposals>[0])
  ).toEqual({ ok: false, error: "invalid_field" });
});

it("does not redo a refresh that is still running", async () => {
  await asSuperMaker();
  await queueToolRefresh({ toolIds: [toolId], includeDescription: false, note: null });
  const [queued] = await listRefreshesForTool(toolId);
  expect(await refreshAgain({ refreshId: queued.id, note: null, includeDescription: false })).toEqual({ ok: false, error: "not_editable" });
});
