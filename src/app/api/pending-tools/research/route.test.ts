// @vitest-environment node
import { eq, inArray } from "drizzle-orm";

import { resetAuthForTests } from "@/lib/auth/config";
import { signInAsNew, type SignedInSession } from "../../../../../test/utils/session";

/**
 * `POST /api/pending-tools/research` against the demo-seeded PGlite database
 * (spec §10 "Routes: research start: limits, only the given ids are queued,
 * and `start()` called with them").
 *
 * `start` is mocked — the workflow tier has its own test — and so is the
 * workflow module, so what this file asserts is the route's own contract: the
 * order of its checks, that a refusal moves nothing, and exactly what it hands
 * the workflow.
 */

const wf = vi.hoisted(() => ({
  start: vi.fn(),
  researchBatch: Object.assign(async () => ({ researched: 0, failed: 0 }), { workflowId: "research-batch" }),
}));

const imageWf = vi.hoisted(() => ({
  findDifferentImage: Object.assign(async () => "done", { workflowId: "image-retry" }),
}));

vi.mock("workflow/api", () => ({ start: wf.start }));
vi.mock("../../../../workflows/research-batch", () => ({ researchBatch: wf.researchBatch }));
vi.mock("../../../../workflows/image-retry", () => ({ findDifferentImage: imageWf.findDifferentImage }));

/** Withhold permissions for one test — see `admin/corrections/actions.test.ts`. */
const override = vi.hoisted(() => ({ permissions: null as Set<string> | null }));

vi.mock("../../../../lib/auth/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/auth/permissions")>();
  return {
    ...actual,
    can: (subject: Parameters<typeof actual.can>[0], permission: string) =>
      override.permissions
        ? subject?.role !== "anonymous" && override.permissions.has(permission)
        : actual.can(subject, permission as Parameters<typeof actual.can>[1]),
  };
});

import {
  createPendingBatch,
  getPendingTool,
  queueForResearch,
  setWorkflowRun,
  updatePendingTool,
} from "@/lib/data/pending-tools";
import { grantResearchAllowance } from "@/lib/data/research-allowances";
import { getDb, resetDbForTests } from "@/lib/db/client";
import { pendingTools, researchRequests } from "@/lib/db/schema/index";
import { REVIEWER_NOTE_MAX_CHARS } from "@/lib/intake/limits";
import type { PendingApiError, ResearchStartedResponse } from "@/lib/intake/types";
import type { ResearchResult } from "@/lib/research/result";
import { POST } from "./route";

const AUTH_SECRET = "research-route-test-secret";

let counter = 0;
let admin: SignedInSession;

function uniqueIp() {
  counter += 1;
  return `10.9.${Math.floor(counter / 250)}.${counter % 250}`;
}

async function newAdmin(role: "admin" | "user" = "admin"): Promise<SignedInSession> {
  counter += 1;
  return signInAsNew({ email: `research-${counter}-${crypto.randomUUID().slice(0, 6)}@cornell.edu`, role });
}

function request(body: unknown, session: SignedInSession | null = admin): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": uniqueIp(),
  };
  if (session) headers.cookie = session.cookie;
  return new Request("http://localhost/api/pending-tools/research", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function post(body: unknown, session: SignedInSession | null = admin) {
  const res = await POST(request(body, session) as never);
  return { status: res.status, body: (await res.json()) as PendingApiError & ResearchStartedResponse };
}

/**
 * Pending items owned by `owner`, identified in one batch.
 *
 * Each gets a random name: the duplicate check compares every new item with
 * the pending items of *other* batches by trigram similarity, and a run of
 * "Research route item 1", "Research route item 2" across tests would match
 * each other and come back as unresolved duplicates. Pass `name` to be one on
 * purpose.
 */
async function items(count: number, owner: SignedInSession = admin, name?: string): Promise<string[]> {
  const created = await createPendingBatch({
    createdBy: owner.user.id,
    items: Array.from({ length: count }, () => ({ name: name ?? randomName() })),
  });
  return created.items.map((item) => item.id);
}

function randomName(): string {
  return `Z${crypto.randomUUID().replace(/-/g, "")}`;
}

async function rows(ids: string[]) {
  const db = await getDb();
  return db.select().from(pendingTools).where(inArray(pendingTools.id, ids));
}

async function statuses(ids: string[]) {
  const found = await rows(ids);
  return ids.map((id) => found.find((row) => row.id === id)?.status);
}

let runCounter = 0;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  resetAuthForTests();
  override.permissions = null;
  wf.start.mockReset();
  wf.start.mockImplementation(async () => ({ runId: `wrun_test_${++runCounter}` }));
  vi.spyOn(console, "error").mockImplementation(() => {});
  admin = await newAdmin();
});

afterEach(() => {
  resetAuthForTests();
});

afterAll(() => {
  resetDbForTests();
});

describe("POST /api/pending-tools/research — who may ask", () => {
  it("answers 401 sign_in_required to an anonymous caller", async () => {
    const ids = await items(1);
    const res = await post({ ids }, null);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("sign_in_required");
    expect(await statuses(ids)).toEqual(["identified"]);
  });

  it("answers 403 forbidden to a signed-in person without tools.add", async () => {
    const ids = await items(1);
    const res = await post({ ids }, await newAdmin("user"));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("forbidden");
    expect(res.body.ids).toBeUndefined();
  });

  it("answers 429 rate_limited after ten presses in a minute", async () => {
    const ids = await items(1);
    for (let i = 0; i < 10; i += 1) {
      expect((await post({ ids: [] })).status).toBe(400);
    }
    const res = await post({ ids });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("rate_limited");
    expect(await statuses(ids)).toEqual(["identified"]);
  });

  it("answers 403 with the ids for an item somebody else identified, to a caller without tools.approve", async () => {
    const owner = await newAdmin();
    const theirs = await items(1, owner);
    const mine = await items(1);
    override.permissions = new Set(["tools.add"]);

    const res = await post({ ids: [...mine, ...theirs] });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "forbidden", ids: theirs });
    expect(await statuses([...mine, ...theirs])).toEqual(["identified", "identified"]);
    expect(wf.start).not.toHaveBeenCalled();
  });

  it("lets an approver research somebody else's item", async () => {
    const theirs = await items(1, await newAdmin());
    const res = await post({ ids: theirs });
    expect(res.status).toBe(202);
    expect(res.body.queued).toEqual(theirs);
  });
});

describe("POST /api/pending-tools/research — the body and the items", () => {
  it("answers 400 invalid_body to a body that is not a list of ids", async () => {
    for (const body of ["not json", {}, { ids: [] }, { ids: ["not-a-uuid"] }, { ids: [crypto.randomUUID()], extra: 1 }]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("invalid_body");
    }
  });

  it("answers 400 too_many_items to 26 ids and queues nothing", async () => {
    const ids = await items(26);
    const res = await post({ ids });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("too_many_items");
    expect(new Set(await statuses(ids))).toEqual(new Set(["identified"]));
    expect(wf.start).not.toHaveBeenCalled();
  });

  it("counts ids after removing repeats", async () => {
    const ids = await items(25);
    const res = await post({ ids: [...ids, ids[0]] });
    expect(res.status).toBe(202);
    expect(res.body.queued).toHaveLength(25);
  });

  it("answers 404 not_found with the ids that do not exist", async () => {
    const ids = await items(1);
    const missing = crypto.randomUUID();
    const res = await post({ ids: [...ids, missing] });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: "not_found", ids: [missing] });
    expect(await statuses(ids)).toEqual(["identified"]);
  });

  it("answers 409 unresolved_duplicate for a duplicate nobody has decided on", async () => {
    const [plain] = await items(1);
    // "Form 4" is a demo tool, so this item is born a duplicate.
    const [dup] = await items(1, admin, "Form 4");
    expect((await getPendingTool(dup))?.duplicateOfToolId).not.toBeNull();

    const res = await post({ ids: [plain, dup] });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "unresolved_duplicate", ids: [dup] });
    expect(await statuses([plain, dup])).toEqual(["identified", "identified"]);
  });

  it("answers 409 not_researchable for an item a run already holds", async () => {
    const [free, held] = await items(2);
    await queueForResearch([held], { requestedBy: admin.user.id });
    await setWorkflowRun([held], "wrun_elsewhere");

    const res = await post({ ids: [free, held] });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "not_researchable", ids: [held] });
    expect(await statuses([free])).toEqual(["identified"]);
  });

  it("answers 429 daily_limit past a hundred items a day, with what is left, and moves nothing", async () => {
    const earlier = await items(95);
    expect(await queueForResearch(earlier, { requestedBy: admin.user.id })).toHaveLength(95);

    const more = await items(6);
    const res = await post({ ids: more });
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ code: "daily_limit", remaining: 5 });
    expect(new Set(await statuses(more))).toEqual(new Set(["identified"]));
    expect(wf.start).not.toHaveBeenCalled();

    // Five still fit.
    expect((await post({ ids: more.slice(0, 5) })).status).toBe(202);
  });

  it("adds a running setup allowance to the daily hundred (bulk intake spec §4.2)", async () => {
    const earlier = await items(100);
    expect(await queueForResearch(earlier, { requestedBy: admin.user.id })).toHaveLength(100);
    const more = await items(10);
    expect((await post({ ids: more })).body).toMatchObject({ code: "daily_limit", remaining: 0 });

    await grantResearchAllowance({ userId: admin.user.id, extraItems: 400, days: 7, grantedBy: admin.user.id });
    const res = await post({ ids: more });
    expect(res.status).toBe(202);
    expect(res.body.queued).toHaveLength(10);
  });

  it("counts every press: researching the same items again spends the allowance again", async () => {
    const ids = await items(25);
    for (let press = 1; press <= 4; press += 1) {
      const res = await post({ ids });
      expect(res.status).toBe(202);
      // The run finished; every item is researchable again.
      const db = await getDb();
      await db.update(pendingTools).set({ status: "researched" }).where(inArray(pendingTools.id, ids));
    }

    const fifth = await post({ ids });
    expect(fifth.status).toBe(429);
    expect(fifth.body).toMatchObject({ code: "daily_limit", remaining: 0 });
    expect(wf.start).toHaveBeenCalledTimes(4);
  });

  it("serves simultaneous presses one at a time, so together they cannot pass the limit", async () => {
    const earlier = await items(75);
    expect(await queueForResearch(earlier, { requestedBy: admin.user.id })).toHaveLength(75);
    const batches = await Promise.all([items(25), items(25), items(25), items(25)]);

    const answers = await Promise.all(batches.map((ids) => post({ ids })));

    expect(answers.map((res) => res.status).sort()).toEqual([202, 429, 429, 429]);
    expect(wf.start).toHaveBeenCalledTimes(1);
    const queued = await rows(batches.flat());
    expect(queued.filter((row) => row.status === "queued")).toHaveLength(25);
  });
});

describe("POST /api/pending-tools/research — what moves", () => {
  it("queues only the given ids, starts one run with exactly them, and stores its id", async () => {
    const [a, b, c] = await items(3);

    const res = await post({ ids: [a, b] });

    expect(res.status).toBe(202);
    expect(res.body.queued).toEqual([a, b]);
    expect(res.body.readyAsUnit).toEqual([]);
    expect(res.body.runId).toBe(`wrun_test_${runCounter}`);
    expect(wf.start).toHaveBeenCalledTimes(1);
    expect(wf.start).toHaveBeenCalledWith(wf.researchBatch, [res.body.requestId, [a, b]]);

    const stored = await rows([a, b, c]);
    const byId = new Map(stored.map((row) => [row.id, row]));
    expect(byId.get(a)).toMatchObject({ status: "queued", workflowRunId: res.body.runId, researchRequestedBy: admin.user.id });
    expect(byId.get(b)).toMatchObject({ status: "queued", workflowRunId: res.body.runId });
    expect(byId.get(c)).toMatchObject({ status: "identified", workflowRunId: null });
  });

  it("settles add-unit items straight away and never hands them to the workflow", async () => {
    const [plain] = await items(1);
    const [unit] = await items(1, admin, "Form 4");
    const decided = await updatePendingTool(unit, { duplicateResolution: "add_unit" });
    expect(decided.ok).toBe(true);

    const res = await post({ ids: [plain, unit] });

    expect(res.status).toBe(202);
    expect(res.body.readyAsUnit).toEqual([unit]);
    expect(res.body.queued).toEqual([plain]);
    expect(wf.start).toHaveBeenCalledWith(wf.researchBatch, [res.body.requestId, [plain]]);
    const settled = await getPendingTool(unit);
    expect(settled).toMatchObject({ status: "researched", research: null, workflowRunId: null });
  });

  it("answers 200 with no run when only add-unit items were sent", async () => {
    const [unit] = await items(1, admin, "Form 4");
    await updatePendingTool(unit, { duplicateResolution: "add_unit" });

    const res = await post({ ids: [unit] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ runId: null, queued: [], readyAsUnit: [unit] });
    expect(wf.start).not.toHaveBeenCalled();
  });

  it("does not count add-unit items against the day's allowance", async () => {
    const earlier = await items(100);
    expect(await queueForResearch(earlier, { requestedBy: admin.user.id })).toHaveLength(100);
    const [unit] = await items(1, admin, "Form 4");
    await updatePendingTool(unit, { duplicateResolution: "add_unit" });

    const res = await post({ ids: [unit] });
    expect(res.status).toBe(200);
  });

  it("says start_failed when the workflow will not start, leaves the items queued with why, and retries on the same POST", async () => {
    const ids = await items(2);
    wf.start.mockRejectedValueOnce(new Error("world unavailable"));

    const failed = await post({ ids });
    expect(failed.status).toBe(502);
    expect(failed.body).toMatchObject({ code: "start_failed", ids });

    const stuck = await rows(ids);
    for (const row of stuck) {
      expect(row.status).toBe("queued");
      expect(row.workflowRunId).toBeNull();
      expect(row.researchError).toBe("Could not start research: world unavailable");
    }

    // The Retry button is the same request.
    const retried = await post({ ids });
    expect(retried.status).toBe(202);
    expect(retried.body.queued).toEqual(ids);
    expect(wf.start).toHaveBeenCalledTimes(2);
    const started = await rows(ids);
    for (const row of started) {
      expect(row).toMatchObject({ status: "queued", workflowRunId: retried.body.runId, researchError: null });
    }
  });

  it("refuses a second press on items another press just queued, rather than calling it done", async () => {
    const ids = await items(1);
    const db = await getDb();
    // Queued a moment ago by a request that has not reached start() yet.
    await db
      .update(pendingTools)
      .set({ status: "queued", researchRequestedBy: admin.user.id, researchRequestedAt: new Date() })
      .where(eq(pendingTools.id, ids[0]));

    const res = await post({ ids });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "not_researchable", ids });
    expect(wf.start).not.toHaveBeenCalled();
  });

  it("retries a queued item whose start stalled without recording why", async () => {
    const ids = await items(1);
    const db = await getDb();
    // start() threw and the failure could not be written, or the function was
    // killed: queued, no run, no error — and six minutes old.
    await db
      .update(pendingTools)
      .set({
        status: "queued",
        researchRequestedBy: admin.user.id,
        researchRequestedAt: new Date(Date.now() - 6 * 60_000),
      })
      .where(eq(pendingTools.id, ids[0]));

    const res = await post({ ids });
    expect(res.status).toBe(202);
    expect(res.body.queued).toEqual(ids);
    expect(wf.start).toHaveBeenCalledTimes(1);
  });

  it("stamps the request id it starts the run with on the rows", async () => {
    const ids = await items(2);
    const res = await post({ ids });
    expect(res.status).toBe(202);
    for (const row of await rows(ids)) expect(row.researchRequestId).toBe(res.body.requestId);
  });
});

describe('POST /api/pending-tools/research — a reviewer\'s note (amendment "reviewer notes")', () => {
  it("hands the cleaned note to the run with the one item", async () => {
    const [a] = await items(1);
    const res = await post({ ids: [a], note: "  use the bambulab.com\nX2D product page " });
    expect(res.status).toBe(202);
    expect(wf.start).toHaveBeenCalledWith(wf.researchBatch, [res.body.requestId, [a], "use the bambulab.com X2D product page"]);
  });

  it("starts with no note when the note is blank", async () => {
    const [a] = await items(1);
    const res = await post({ ids: [a], note: "   " });
    expect(res.status).toBe(202);
    expect(wf.start).toHaveBeenCalledWith(wf.researchBatch, [res.body.requestId, [a]]);
  });

  it("refuses a note over the cap, a note on several items, and a note from someone who cannot approve — moving nothing", async () => {
    const [a, b] = await items(2);
    expect((await post({ ids: [a], note: "x".repeat(REVIEWER_NOTE_MAX_CHARS + 1) })).status).toBe(400);
    expect((await post({ ids: [a, b], note: "use the product page" })).status).toBe(400);

    override.permissions = new Set(["tools.add"]);
    const refused = await post({ ids: [a], note: "use the product page" });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("forbidden");
    override.permissions = null;

    expect(wf.start).not.toHaveBeenCalled();
    expect(await statuses([a, b])).toEqual(["identified", "identified"]);
  });
});

describe('POST /api/pending-tools/research — a guided redo (amendment "Guided redo (focus + guidance)")', () => {
  const RESULT: ResearchResult = {
    canonicalName: "Z printer",
    description: "A printer.",
    specs: [],
    materials: [],
    ppeRequired: [],
    tags: [],
    trainingRequired: null,
    useRestrictions: null,
    category: { name: "FDM", group: null, existingId: null },
    resources: [],
    droppedLinks: [],
    sourceUrls: [],
    evidence: {
      userStatedModel: true,
      modelPlateRead: null,
      manufacturerPageFound: false,
      manualFound: false,
      specsFromSource: false,
      categoryOnly: false,
    },
    confidence: { level: "medium", basis: [], unknowns: [] },
    images: { candidates: [], cleaned: null },
  };

  /** One item as research leaves it: `researched`, with a stored result. */
  async function researched(extra: Partial<ResearchResult> = {}): Promise<string> {
    const [id] = await items(1);
    const db = await getDb();
    await db
      .update(pendingTools)
      .set({ status: "researched", research: { ...RESULT, ...extra } })
      .where(eq(pendingTools.id, id));
    return id;
  }

  it("hands the focus and the note to the run, and marks the stored result with the redo", async () => {
    const id = await researched();
    const res = await post({ ids: [id], note: "use the spec\ntable", focus: ["links", "specs"] });
    expect(res.status).toBe(202);
    expect(wf.start).toHaveBeenCalledWith(wf.researchBatch, [res.body.requestId, [id], "use the spec table", ["specs", "links"]]);
    const stored = (await getPendingTool(id))?.research;
    expect(stored?.redoRequest).toMatchObject({ requestId: res.body.requestId, focus: ["specs", "links"] });
    // Everything else on the stored result is untouched while it waits.
    expect(stored?.description).toBe(RESULT.description);
  });

  it("sends a focus with no note as null, and everything as no focus at all", async () => {
    const a = await researched();
    const first = await post({ ids: [a], focus: ["description"] });
    expect(wf.start).toHaveBeenLastCalledWith(wf.researchBatch, [first.body.requestId, [a], null, ["description"]]);

    const b = await researched();
    const second = await post({ ids: [b], focus: ["everything"] });
    expect(second.status).toBe(202);
    expect(wf.start).toHaveBeenLastCalledWith(wf.researchBatch, [second.body.requestId, [b]]);
    // A Research again of everything still says what it is doing.
    expect((await getPendingTool(b))?.research?.redoRequest).toMatchObject({ focus: [] });
  });

  it("runs the image stage alone for an image-only focus: Find a different image, one against the allowance", async () => {
    const id = await researched();
    const res = await post({ ids: [id], note: "a front view", focus: ["image"] });
    expect(res.status).toBe(202);
    expect(res.body.imageOnly).toBe(true);
    expect(res.body.queued).toEqual([]);
    expect(wf.start).toHaveBeenCalledTimes(1);
    expect(wf.start).toHaveBeenCalledWith(imageWf.findDifferentImage, [res.body.requestId, id, "a front view"]);
    const row = (await rows([id]))[0];
    // Not queued: the item stays researched while its image search runs.
    expect(row.status).toBe("researched");
    expect((row.research as ResearchResult).imageRetry).toMatchObject({ status: "running", note: "a front view" });
    const db = await getDb();
    const ledger = await db.select().from(researchRequests).where(eq(researchRequests.pendingToolId, id));
    expect(ledger).toHaveLength(1);
  });

  it("refuses another press while that image search runs", async () => {
    const id = await researched();
    expect((await post({ ids: [id], focus: ["image"] })).status).toBe(202);
    const again = await post({ ids: [id], focus: ["specs"] });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("image_retry_running");
    expect(await statuses([id])).toEqual(["researched"]);
  });

  it("refuses a focus on several items, an unknown focus, a focus without tools.approve, and one with nothing to merge into", async () => {
    const [a, b] = [await researched(), await researched()];
    expect((await post({ ids: [a, b], focus: ["specs"] })).status).toBe(400);
    expect((await post({ ids: [a], focus: ["tags"] })).status).toBe(400);
    expect((await post({ ids: [a], focus: "specs" })).status).toBe(400);

    override.permissions = new Set(["tools.add"]);
    expect((await post({ ids: [a], focus: ["specs"] })).status).toBe(403);
    override.permissions = null;

    const [fresh] = await items(1);
    const nothing = await post({ ids: [fresh], focus: ["specs"] });
    expect(nothing.status).toBe(409);
    expect(nothing.body.code).toBe("not_researchable");

    expect(wf.start).not.toHaveBeenCalled();
    expect(await statuses([a, b, fresh])).toEqual(["researched", "researched", "identified"]);
  });

  it("accepts a one-paragraph note up to the new cap", async () => {
    const id = await researched();
    const note = "x".repeat(REVIEWER_NOTE_MAX_CHARS);
    const res = await post({ ids: [id], note, focus: ["specs"] });
    expect(res.status).toBe(202);
    expect(wf.start).toHaveBeenCalledWith(wf.researchBatch, [res.body.requestId, [id], note, ["specs"]]);
  });
});
