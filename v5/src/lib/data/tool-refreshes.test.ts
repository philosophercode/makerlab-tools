// @vitest-environment node
import { eq, sql } from "drizzle-orm";
import { createPgliteDb } from "../db/pglite";
import { researchRequests, toolRefreshes, tools, user } from "../db/schema/index";
import type { Db } from "../db/types";
import { researchFixture } from "../refresh/fixtures.test-helpers";
import type { FieldProposal } from "../refresh/types";
import { expectViolation } from "../../../test/db";
import { countResearchRequestedSince, createPendingBatch, queueForResearchWithinAllowance } from "./pending-tools";
import {
  ABANDONED_REFRESH_MESSAGE,
  claimRefresh,
  closeEmptyRefresh,
  completeRefresh,
  failRefresh,
  failRefreshStart,
  getRefresh,
  getRefreshRowRevision,
  listRefreshQueue,
  loadRefreshSubject,
  openRefreshesByTool,
  queueRefreshesWithinAllowance,
  saveRefreshDecisions,
} from "./tool-refreshes";

/**
 * `tool_refreshes` against a real (in-process) Postgres (refresh research spec
 * §4.1, §5.1, §10 "Queueing"): the allowance shared with intake, one open
 * refresh per tool, the skipped count, and every transition as this run's only.
 */

let db: Db;
const ADMIN = "refresh-admin";
const OTHER = "refresh-other";
const DAY_MS = 24 * 60 * 60_000;

beforeAll(async () => {
  db = await createPgliteDb();
  await db.insert(user).values([
    { id: ADMIN, name: "Niti", email: "refresh-admin@cornell.edu", role: "admin" },
    { id: OTHER, name: "Luis", email: "refresh-other@cornell.edu", role: "admin" },
  ]);
});

beforeEach(async () => {
  await db.delete(researchRequests);
  await db.delete(toolRefreshes);
  await db.delete(tools);
});

async function addTool(name: string): Promise<string> {
  const [row] = await db
    .insert(tools)
    .values({ name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), published: true })
    .returning({ id: tools.id });
  return row.id;
}

function queue(toolIds: string[], overrides: Partial<Parameters<typeof queueRefreshesWithinAllowance>[1]> = {}) {
  return queueRefreshesWithinAllowance(
    toolIds,
    {
      requestedBy: ADMIN,
      requestId: crypto.randomUUID(),
      limit: 100,
      since: new Date(Date.now() - DAY_MS),
      note: null,
      includeDescription: false,
      ...overrides,
    },
    { db }
  );
}

describe("queueRefreshesWithinAllowance", () => {
  it("queues one refresh per tool with the tool's revision, and charges the ledger", async () => {
    const a = await addTool("Form 4");
    const b = await addTool("Trotec Speedy 400");
    const result = await queue([a, b], { note: "the 80 W model", includeDescription: true });
    expect(result).toMatchObject({ ok: true, skipped: [], missing: [] });
    if (!result.ok) throw new Error("unreachable");
    expect(result.queued.map((row) => row.toolId)).toEqual([a, b]);

    const refresh = await getRefresh(result.queued[0].refreshId, { db });
    const subject = await loadRefreshSubject(a, { db });
    expect(refresh).toMatchObject({ status: "queued", note: "the 80 W model", includeDescription: true, requestedBy: ADMIN });
    expect(refresh?.baseRevision).toBe(subject?.revision);
    expect(await countResearchRequestedSince(ADMIN, new Date(Date.now() - DAY_MS), { db })).toBe(2);
    const ledger = await db.select().from(researchRequests);
    expect(ledger.every((row) => row.toolRefreshId !== null && row.pendingToolId === null)).toBe(true);
  });

  it("skips a tool with an open refresh, says so, and charges nothing for it", async () => {
    const a = await addTool("Form 4");
    const b = await addTool("Trotec Speedy 400");
    await queue([a]);
    const result = await queue([a, b]);
    expect(result).toMatchObject({ ok: true, skipped: [a] });
    if (!result.ok) throw new Error("unreachable");
    expect(result.queued.map((row) => row.toolId)).toEqual([b]);
    expect(await countResearchRequestedSince(ADMIN, new Date(Date.now() - DAY_MS), { db })).toBe(2);
  });

  it("names ids that are no tool", async () => {
    const result = await queue(["00000000-0000-4000-8000-000000000000", "not-a-uuid"]);
    expect(result).toMatchObject({ ok: true, queued: [], missing: ["not-a-uuid", "00000000-0000-4000-8000-000000000000"] });
  });

  it("shares intake's daily allowance and refuses a press that would pass it, queueing nothing", async () => {
    const { items } = await createPendingBatch({ createdBy: ADMIN, items: [{ name: "A" }, { name: "B" }] }, { db });
    await queueForResearchWithinAllowance(
      items.map((item) => item.id),
      { requestedBy: ADMIN, requestId: crypto.randomUUID(), limit: 100, since: new Date(Date.now() - DAY_MS) },
      { db }
    );
    const a = await addTool("Form 4");
    const b = await addTool("Trotec Speedy 400");
    expect(await queue([a, b], { limit: 3 })).toEqual({ ok: false, reason: "daily_limit", remaining: 1 });
    expect(await db.select().from(toolRefreshes)).toHaveLength(0);
    // Somebody else's allowance is their own.
    expect(await queue([a, b], { limit: 3, requestedBy: OTHER })).toMatchObject({ ok: true });
  });

  it("allows one open refresh per tool at the database, whatever the caller does", async () => {
    const a = await addTool("Form 4");
    await queue([a]);
    await expectViolation(
      db.insert(toolRefreshes).values({ toolId: a, requestId: crypto.randomUUID(), baseRevision: "1", status: "proposed" }),
      /tool_refreshes_one_open_idx/
    );
  });

  it("fails a refresh a dead run abandoned a day ago, so it no longer blocks the tool", async () => {
    const a = await addTool("Form 4");
    await queue([a]);
    await db.execute(sql`alter table tool_refreshes disable trigger tool_refreshes_set_updated_at`);
    await db.execute(sql`update tool_refreshes set updated_at = now() - interval '25 hours'`);
    await db.execute(sql`alter table tool_refreshes enable trigger tool_refreshes_set_updated_at`);
    const result = await queue([a]);
    expect(result).toMatchObject({ ok: true, skipped: [] });
    const rows = await db.select().from(toolRefreshes).where(eq(toolRefreshes.status, "failed"));
    expect(rows[0]?.researchError).toBe(ABANDONED_REFRESH_MESSAGE);
  });
});

describe("the run's transitions", () => {
  async function queued(): Promise<{ id: string; requestId: string; toolId: string }> {
    const toolId = await addTool(`Tool ${crypto.randomUUID().slice(0, 4)}`);
    const requestId = crypto.randomUUID();
    const result = await queue([toolId], { requestId });
    if (!result.ok) throw new Error("unreachable");
    return { id: result.queued[0].refreshId, requestId, toolId };
  }

  const PROPOSALS: FieldProposal[] = [
    { id: "use_restrictions", field: "use_restrictions", kind: "new", safety: true, current: null, proposed: "Trained users only.", citations: [], decision: "pending" },
  ];

  it("claims for its own request only, and completes with validated proposals", async () => {
    const { id, requestId } = await queued();
    expect(await claimRefresh(id, crypto.randomUUID(), { db })).toBeNull();
    expect((await claimRefresh(id, requestId, { db }))?.status).toBe("researching");
    // A retry of the claiming step finds its own claim.
    expect((await claimRefresh(id, requestId, { db }))?.status).toBe("researching");
    expect(await completeRefresh(id, crypto.randomUUID(), researchFixture(), PROPOSALS, { db })).toBe(false);
    expect(await completeRefresh(id, requestId, researchFixture(), PROPOSALS, { db })).toBe(true);
    const refresh = await getRefresh(id, { db });
    expect(refresh).toMatchObject({ status: "proposed", proposals: PROPOSALS });
    expect(refresh?.research?.canonicalName).toBe("WEN DC3401");
  });

  it("refuses to store proposals that do not parse", async () => {
    const { id, requestId } = await queued();
    await claimRefresh(id, requestId, { db });
    await expect(
      completeRefresh(id, requestId, researchFixture(), [{ field: "ppe_required" } as unknown as FieldProposal], { db })
    ).rejects.toThrow();
  });

  it("fails for its own request only; a start failure fails the queued rows", async () => {
    const { id, requestId } = await queued();
    expect(await failRefresh(id, crypto.randomUUID(), "nope", { db })).toBe(false);
    expect(await failRefresh(id, requestId, "Research (search): the provider refused", { db })).toBe(true);
    expect((await getRefresh(id, { db }))?.researchError).toMatch(/provider refused/);

    const second = await queued();
    await failRefreshStart([second.id], "Could not start refresh research: boom", { db });
    expect((await getRefresh(second.id, { db }))?.status).toBe("failed");
  });

  it("records decisions only against the row revision the page read, and closes when told", async () => {
    const { id, requestId, toolId } = await queued();
    await claimRefresh(id, requestId, { db });
    await completeRefresh(id, requestId, researchFixture(), PROPOSALS, { db });
    const revision = (await getRefreshRowRevision(id, { db }))!;
    const decided = PROPOSALS.map((p) => ({ ...p, decision: "rejected" as const }));
    expect(await saveRefreshDecisions(id, "0", { proposals: decided, baseRevision: "x", decidedBy: ADMIN, close: true }, { db })).toBe(false);
    expect(await saveRefreshDecisions(id, revision, { proposals: decided, baseRevision: "x", decidedBy: ADMIN, close: true }, { db })).toBe(true);
    expect(await getRefresh(id, { db })).toMatchObject({ status: "decided", decidedBy: ADMIN, baseRevision: "x" });
    expect((await openRefreshesByTool({ db })).has(toolId)).toBe(false);
  });

  it("lists open and failed refreshes with their tool, the latest per tool, and closes an empty one", async () => {
    const { id, requestId } = await queued();
    await claimRefresh(id, requestId, { db });
    await completeRefresh(id, requestId, researchFixture(), [], { db });
    const rows = await listRefreshQueue({ db });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id, status: "proposed", toolPublished: true, toolArchived: false });
    expect(await closeEmptyRefresh(id, ADMIN, { db })).toBe(true);
    expect(await listRefreshQueue({ db })).toHaveLength(0);
  });
});
