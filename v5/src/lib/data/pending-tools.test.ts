// @vitest-environment node
import { eq, sql } from "drizzle-orm";
import { createPgliteDb } from "../db/pglite";
import { attachments, pendingTools, researchRequests, tools, user } from "../db/schema/index";
import type { Db } from "../db/types";
import type { ResearchResult } from "../research/result";
import {
  completeResearch,
  countResearchRequestedSince,
  createPendingBatch,
  deleteDiscardedPendingTools,
  discardPendingTool,
  expireIdentifiedPendingTools,
  failResearch,
  getPendingTool,
  INVALID_STORED_RESEARCH,
  listIntakeQueue,
  listPendingTools,
  markReadyAsUnit,
  markResearching,
  queueForResearch,
  queueForResearchWithinAllowance,
  recordStartFailure,
  releasePhotosOfMissingPendingTools,
  setWorkflowRun,
  updatePendingTool,
} from "./pending-tools";

/**
 * The pending-tools lifecycle against a real (in-process) Postgres (spec §4.10,
 * §5.4): creating a batch, editing and discarding, and every research
 * transition. Approval has its own file, `pending-tools.approve.test.ts`.
 *
 * The property most of these assert is the same one: each transition's WHERE
 * clause carries the state it moves from, so a second caller — a repeat
 * Research press, a research step finishing after a discard — changes nothing.
 */

let db: Db;
const OWNER = "pending-owner";
const OTHER = "pending-other";

beforeAll(async () => {
  db = await createPgliteDb();
  await db.insert(user).values([
    { id: OWNER, name: "Niti Parikh", email: "owner@cornell.edu" },
    { id: OTHER, name: "Luis", email: "other@cornell.edu" },
  ]);
});

beforeEach(async () => {
  await db.delete(researchRequests);
  await db.delete(pendingTools);
  await db.delete(attachments);
  await db.delete(tools);
});

async function upload(overrides: Partial<typeof attachments.$inferInsert> = {}): Promise<string> {
  const [row] = await db
    .insert(attachments)
    .values({
      blobPathname: `uploads/chat/${crypto.randomUUID()}.png`,
      access: "private",
      contentType: "image/png",
      // The chat's uploads carry who sent them; a pending item claims only its
      // owner's.
      uploadedBy: OWNER,
      ...overrides,
    })
    .returning({ id: attachments.id });
  return row.id;
}

async function oneItem(name = "Prusa MK4S", extra: Record<string, unknown> = {}): Promise<string> {
  const batch = await createPendingBatch({ createdBy: OWNER, items: [{ name, ...extra }] }, { db });
  return batch.items[0].id;
}

async function setStatus(id: string, values: Partial<typeof pendingTools.$inferInsert>) {
  await db.update(pendingTools).set(values).where(eq(pendingTools.id, id));
}

function research(level: "high" | "low" = "high"): ResearchResult {
  return {
    canonicalName: "Prusa MK4S",
    description: "An FDM printer.",
    specs: [],
    materials: ["PLA"],
    ppeRequired: [],
    tags: [],
    trainingRequired: null,
    useRestrictions: null,
    category: { name: "FDM", group: "3D Printing", existingId: null },
    resources: [],
    droppedLinks: [],
    sourceUrls: [],
    evidence: {
      userStatedModel: level === "high",
      modelPlateRead: null,
      manufacturerPageFound: level === "high",
      manualFound: false,
      specsFromSource: false,
      categoryOnly: false,
    },
    confidence: { level, basis: [], unknowns: [] },
  };
}

describe("createPendingBatch", () => {
  it("creates identified rows in one batch, stamped with their owner, in the order given", async () => {
    const batch = await createPendingBatch(
      {
        createdBy: OWNER,
        items: [
          { name: " Prusa MK4S ", brand: "Prusa", categoryHint: "3D Printing", serialNumber: "" },
          { name: "Glowforge Pro", locationHint: "Laser room" },
        ],
      },
      { db }
    );

    const items = await listPendingTools({ ids: batch.items.map((item) => item.id) }, { db });
    expect(items.map((item) => item.name)).toEqual(["Prusa MK4S", "Glowforge Pro"]);
    expect(items.every((item) => item.batchId === batch.batchId)).toBe(true);
    expect(items.every((item) => item.status === "identified")).toBe(true);
    expect(items.every((item) => item.createdBy === OWNER && item.createdByName === "Niti Parikh")).toBe(true);
    expect(items[0]).toMatchObject({ brand: "Prusa", categoryHint: "3D Printing", serialNumber: null });
    expect(items[1]).toMatchObject({ locationHint: "Laser room", brand: null });
  });

  it("claims only unowned uploads and says how many stuck", async () => {
    const free1 = await upload();
    const free2 = await upload();
    const taken = await upload({ ownerType: "project", ownerId: crypto.randomUUID() });
    // Unowned, but somebody else's: an id pasted from their chat claims nothing.
    const theirs = await upload({ uploadedBy: OTHER });
    const anonymous = await upload({ uploadedBy: null });

    const batch = await createPendingBatch(
      {
        createdBy: OWNER,
        items: [
          { name: "Prusa MK4S", attachmentIds: [free2, free1, free1] },
          { name: "Glowforge Pro", attachmentIds: [taken, "not-a-uuid"] },
          { name: "Form 4", attachmentIds: [theirs, anonymous] },
        ],
      },
      { db }
    );

    expect(batch.items.map((item) => [item.photosSubmitted, item.photosAttached])).toEqual([
      [2, 2],
      [2, 0],
      [2, 0],
    ]);
    const [stillUnowned] = await db.select().from(attachments).where(eq(attachments.id, theirs));
    expect(stillUnowned.ownerId).toBeNull();
    const first = await getPendingTool(batch.items[0].id, { db });
    expect(first?.photos.map((photo) => [photo.attachmentId, photo.position, photo.url])).toEqual([
      [free2, 0, null],
      [free1, 1, null],
    ]);
    const [stillTheirs] = await db.select().from(attachments).where(eq(attachments.id, taken));
    expect(stillTheirs.ownerType).toBe("project");
  });

  it("stores the duplicate match found at creation, ignoring the batch's own siblings", async () => {
    const [existing] = await db
      .insert(tools)
      .values({ slug: "bambu-lab-x1-carbon", name: "Bambu Lab X1-Carbon", published: true })
      .returning({ id: tools.id });
    const earlier = await oneItem("Glowforge Pro");

    const batch = await createPendingBatch(
      {
        createdBy: OTHER,
        items: [
          { name: "X1-Carbon", brand: "Bambu Lab" },
          { name: "Glowforge Pro" },
          { name: "Form 4" },
          { name: "Form 4" },
        ],
      },
      { db }
    );

    const items = await listPendingTools({ ids: batch.items.map((item) => item.id) }, { db });
    expect(items[0].duplicateOf).toEqual({
      kind: "tool",
      id: existing.id,
      name: "Bambu Lab X1-Carbon",
      slug: "bambu-lab-x1-carbon",
      published: true,
    });
    expect(items[0].duplicateOfToolId).toBe(existing.id);
    // Another person's pending item is a match — two admins adding the same
    // machine at once must see each other (§5.4 unhappy paths).
    expect(items[1].duplicateOf).toEqual({
      kind: "pending",
      id: earlier,
      name: "Glowforge Pro",
      status: "identified",
    });
    expect(items[2].duplicateOf).toBeNull();
    expect(items[3].duplicateOf).toBeNull();
  });
});

describe("reading", () => {
  it("returns null for an unknown or non-uuid id", async () => {
    expect(await getPendingTool(crypto.randomUUID(), { db })).toBeNull();
    expect(await getPendingTool("prusa", { db })).toBeNull();
  });

  it("lists newest batch first, filtered by status and owner", async () => {
    const older = await oneItem("Older");
    await setStatus(older, { createdAt: new Date("2026-01-01T00:00:00Z") });
    const newer = await oneItem("Newer");
    const theirs = (await createPendingBatch({ createdBy: OTHER, items: [{ name: "Theirs" }] }, { db })).items[0].id;
    await setStatus(theirs, { status: "researched", createdAt: new Date("2025-01-01T00:00:00Z") });

    expect((await listPendingTools({}, { db })).map((item) => item.id)).toEqual([newer, older, theirs]);
    expect((await listPendingTools({ statuses: ["researched"] }, { db })).map((item) => item.id)).toEqual([theirs]);
    expect((await listPendingTools({ createdBy: OWNER }, { db })).map((item) => item.id)).toEqual([newer, older]);
    expect(await listPendingTools({ statuses: [] }, { db })).toEqual([]);
    expect(await listPendingTools({ ids: ["nope"] }, { db })).toEqual([]);
  });

  it("reads stored research that no longer parses as null, and says so", async () => {
    const id = await oneItem();
    await db.execute(
      sql`update pending_tools set status = 'researched', research = '{"canonicalName": 4}'::jsonb where id = ${id}::uuid`
    );
    const item = await getPendingTool(id, { db });
    expect(item?.research).toBeNull();
    expect(item?.researchError).toBe(INVALID_STORED_RESEARCH);
  });
});

describe("updatePendingTool", () => {
  it("edits in the editable statuses, trimming and nulling blanks", async () => {
    const id = await oneItem();
    const result = await updatePendingTool(
      id,
      { name: " Prusa MK4S Kit ", brand: "  ", categoryHint: "FDM" },
      { db }
    );
    expect(result).toMatchObject({ ok: true, item: { name: "Prusa MK4S Kit", brand: null, categoryHint: "FDM" } });

    await setStatus(id, { status: "failed" });
    expect((await updatePendingTool(id, { locationHint: "Bench 2" }, { db })).ok).toBe(true);
  });

  it("refuses an item that is queued, researching, approved or discarded", async () => {
    const id = await oneItem();
    for (const status of ["queued", "researching", "approved", "discarded"] as const) {
      await setStatus(id, { status });
      expect(await updatePendingTool(id, { name: "Changed" }, { db })).toEqual({
        ok: false,
        reason: "not_editable",
      });
    }
    expect((await getPendingTool(id, { db }))?.name).toBe("Prusa MK4S");
  });

  it("says not_found for a missing row and invalid_field for a bad value", async () => {
    expect(await updatePendingTool(crypto.randomUUID(), { name: "x" }, { db })).toEqual({
      ok: false,
      reason: "not_found",
    });
    const id = await oneItem();
    expect(await updatePendingTool(id, { name: "   " }, { db })).toEqual({ ok: false, reason: "invalid_field" });
    expect(await updatePendingTool(id, { brand: "x".repeat(201) }, { db })).toEqual({
      ok: false,
      reason: "invalid_field",
    });
    expect(
      await updatePendingTool(id, { duplicateResolution: "merge" as never }, { db })
    ).toEqual({ ok: false, reason: "invalid_field" });
  });

  it("re-runs the duplicate check on a rename and clears a decision about the old match", async () => {
    const [form] = await db
      .insert(tools)
      .values({ slug: "form-4", name: "Form 4", published: true })
      .returning({ id: tools.id });
    const [glowforge] = await db
      .insert(tools)
      .values({ slug: "glowforge-pro", name: "Glowforge Pro", published: false })
      .returning({ id: tools.id });
    const id = await oneItem("Form 4");
    expect((await updatePendingTool(id, { duplicateResolution: "new_tool" }, { db })).ok).toBe(true);

    // Same match after a cosmetic rename: the decision stands.
    const cosmetic = await updatePendingTool(id, { name: "form-4" }, { db });
    expect(cosmetic).toMatchObject({ ok: true, item: { duplicateOfToolId: form.id, duplicateResolution: "new_tool" } });

    // A different match: the old answer no longer applies.
    const renamed = await updatePendingTool(id, { name: "Glowforge Pro" }, { db });
    expect(renamed).toMatchObject({
      ok: true,
      item: { duplicateOfToolId: glowforge.id, duplicateResolution: null },
    });

    // No match at all.
    const unique = await updatePendingTool(id, { name: "Roland BN-20" }, { db });
    expect(unique).toMatchObject({ ok: true, item: { duplicateOf: null, duplicateResolution: null } });
  });

  it("refuses add_unit without a matched tool", async () => {
    const id = await oneItem("Nothing Like It");
    expect(await updatePendingTool(id, { duplicateResolution: "add_unit" }, { db })).toEqual({
      ok: false,
      reason: "invalid_field",
    });

    await oneItem("Shared Name");
    const second = (await createPendingBatch({ createdBy: OTHER, items: [{ name: "Shared Name" }] }, { db })).items[0].id;
    // Matched a pending item, not a tool: there is no tool to add a unit to.
    expect((await getPendingTool(second, { db }))?.duplicateOf?.kind).toBe("pending");
    expect(await updatePendingTool(second, { duplicateResolution: "add_unit" }, { db })).toEqual({
      ok: false,
      reason: "invalid_field",
    });
  });

  it("treats a discard resolution as a discard", async () => {
    const photo = await upload();
    const id = await oneItem("Prusa MK4S", { attachmentIds: [photo] });
    const result = await updatePendingTool(id, { duplicateResolution: "discard" }, { db });
    expect(result).toMatchObject({ ok: true, item: { status: "discarded", photos: [] } });
  });
});

describe("discardPendingTool", () => {
  it("discards and releases the photos for the orphan sweep", async () => {
    const photos = [await upload(), await upload()];
    const id = await oneItem("Prusa MK4S", { attachmentIds: photos });

    const result = await discardPendingTool(id, { db });

    expect(result).toMatchObject({ ok: true, released: 2, item: { status: "discarded", photos: [] } });
    const rows = await db.select().from(attachments);
    expect(rows.every((row) => row.ownerId === null && row.ownerType === null)).toBe(true);
  });

  it("allows a queued item no run holds, and refuses one a run holds", async () => {
    const id = await oneItem();
    await setStatus(id, { status: "queued", workflowRunId: "run-1" });
    expect(await discardPendingTool(id, { db })).toEqual({ ok: false, reason: "not_editable" });

    await setStatus(id, { workflowRunId: null });
    expect((await discardPendingTool(id, { db })).ok).toBe(true);
    // Twice is not twice.
    expect(await discardPendingTool(id, { db })).toEqual({ ok: false, reason: "not_editable" });
    expect(await discardPendingTool(crypto.randomUUID(), { db })).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("the research lifecycle", () => {
  it("queues only researchable rows, and a second call moves nothing", async () => {
    const identified = await oneItem("A");
    const researched = await oneItem("B");
    await setStatus(researched, { status: "researched" });
    const approved = await oneItem("C");
    await setStatus(approved, { status: "approved" });
    const held = await oneItem("D");
    await setStatus(held, { status: "queued", workflowRunId: "run-1" });
    const addUnit = await oneItem("E");
    await setStatus(addUnit, { duplicateResolution: "add_unit" });
    const discardChoice = await oneItem("F");
    await setStatus(discardChoice, { duplicateResolution: "discard" });

    const ids = [identified, researched, approved, held, addUnit, discardChoice, "not-a-uuid"];
    expect(await queueForResearch(ids, { requestedBy: OTHER }, { db })).toEqual([identified, researched]);

    const queued = await getPendingTool(identified, { db });
    expect(queued).toMatchObject({ status: "queued", researchRequestedBy: OTHER, workflowRunId: null });
    expect(queued?.researchRequestedAt).toBeInstanceOf(Date);

    // The request that queued them is between here and start(): nobody else
    // may start a second run for the same items.
    expect(await queueForResearch(ids, { requestedBy: OTHER }, { db })).toEqual([]);
  });

  it("lets a failed start be retried with the same ids", async () => {
    const id = await oneItem();
    expect(await queueForResearch([id], { requestedBy: OWNER }, { db })).toEqual([id]);

    await recordStartFailure([id], "Could not start research: boom", { db });
    expect(await getPendingTool(id, { db })).toMatchObject({
      status: "queued",
      workflowRunId: null,
      researchError: "Could not start research: boom",
    });

    expect(await queueForResearch([id], { requestedBy: OWNER }, { db })).toEqual([id]);
    expect((await getPendingTool(id, { db }))?.researchError).toBeNull();
  });

  it("takes over a queued item left stale by a request that died before start()", async () => {
    const id = await oneItem();
    await setStatus(id, { status: "queued", researchRequestedAt: new Date(Date.now() - 60 * 60_000) });
    expect(await queueForResearch([id], { requestedBy: OWNER }, { db })).toEqual([id]);
  });

  it("records the run, only where no run is recorded", async () => {
    const id = await oneItem();
    await queueForResearch([id], { requestedBy: OWNER }, { db });
    await setWorkflowRun([id], "run-1", { db });
    await setWorkflowRun([id], "run-2", { db });
    expect((await getPendingTool(id, { db }))?.workflowRunId).toBe("run-1");
    // A start failure after a run exists is not this item's story.
    await recordStartFailure([id], "late", { db });
    expect((await getPendingTool(id, { db }))?.researchError).toBeNull();
  });

  it("settles add-unit items without research, only when they matched a tool", async () => {
    const [tool] = await db
      .insert(tools)
      .values({ slug: "form-4", name: "Form 4" })
      .returning({ id: tools.id });
    const unit = await oneItem("Form 4");
    await setStatus(unit, { duplicateResolution: "add_unit" });
    const noTool = await oneItem("Other");
    await setStatus(noTool, { duplicateResolution: "add_unit" });
    const plain = await oneItem("Plain");

    expect(await markReadyAsUnit([unit, noTool, plain], { requestedBy: OWNER }, { db })).toEqual([unit]);
    expect(await getPendingTool(unit, { db })).toMatchObject({
      status: "researched",
      research: null,
      duplicateOfToolId: tool.id,
    });
  });

  it("counts a person's research requests since a time, add-unit items free", async () => {
    const since = new Date(Date.now() - 24 * 60 * 60_000);
    const a = await oneItem("A");
    const b = await oneItem("B");
    const c = await oneItem("C");
    await queueForResearch([a, b], { requestedBy: OWNER }, { db });
    await queueForResearch([c], { requestedBy: OTHER }, { db });
    const [old] = await db
      .insert(researchRequests)
      .values({ requestId: crypto.randomUUID(), userId: OWNER, requestedAt: new Date(Date.now() - 48 * 60 * 60_000) })
      .returning({ id: researchRequests.id });
    expect(old).toBeDefined();
    const unit = await oneItem("Unit");
    await setStatus(unit, { duplicateResolution: "add_unit" });
    await markReadyAsUnit([unit], { requestedBy: OWNER }, { db });

    expect(await countResearchRequestedSince(OWNER, since, { db })).toBe(2);
    expect(await countResearchRequestedSince(OTHER, since, { db })).toBe(1);
    expect(await countResearchRequestedSince("nobody", since, { db })).toBe(0);
  });

  it("counts every press: researching the same items again costs again, and nobody else's count goes down", async () => {
    const since = new Date(Date.now() - 24 * 60 * 60_000);
    const a = await oneItem("A");
    const b = await oneItem("B");
    await queueForResearch([a, b], { requestedBy: OWNER }, { db });
    await setStatus(a, { status: "researched" });
    await setStatus(b, { status: "failed" });

    // Research again, by the owner and then by an approver.
    expect(await queueForResearch([a, b], { requestedBy: OWNER }, { db })).toEqual([a, b]);
    await setStatus(a, { status: "researched" });
    expect(await queueForResearch([a], { requestedBy: OTHER }, { db })).toEqual([a]);

    expect(await countResearchRequestedSince(OWNER, since, { db })).toBe(4);
    expect(await countResearchRequestedSince(OTHER, since, { db })).toBe(1);
  });

  it("queues within the allowance or refuses with what is left, moving nothing", async () => {
    const since = new Date(Date.now() - 24 * 60 * 60_000);
    const first = [await oneItem("A"), await oneItem("B"), await oneItem("C")];
    const requestId = crypto.randomUUID();
    expect(
      await queueForResearchWithinAllowance(first, { requestedBy: OWNER, requestId, limit: 4, since }, { db })
    ).toEqual({ ok: true, queued: first });
    expect((await getPendingTool(first[0], { db }))?.researchRequestId).toBe(requestId);

    const more = [await oneItem("D"), await oneItem("E")];
    expect(
      await queueForResearchWithinAllowance(
        more,
        { requestedBy: OWNER, requestId: crypto.randomUUID(), limit: 4, since },
        { db }
      )
    ).toEqual({ ok: false, reason: "daily_limit", remaining: 1 });
    expect((await listPendingTools({ ids: more }, { db })).map((item) => item.status)).toEqual([
      "identified",
      "identified",
    ]);
    expect(await countResearchRequestedSince(OWNER, since, { db })).toBe(3);
  });

  it("lets only the request that queued a row claim, complete or fail it", async () => {
    const id = await oneItem();
    const first = crypto.randomUUID();
    await queueForResearch([id], { requestedBy: OWNER, requestId: first }, { db });
    // A later press took the row over (a start that looked failed, retried).
    await recordStartFailure([id], "Could not start research: timeout", { db });
    const second = crypto.randomUUID();
    expect(await queueForResearch([id], { requestedBy: OWNER, requestId: second }, { db })).toEqual([id]);

    expect(await markResearching(id, { db, requestId: first })).toBeNull();
    expect(await failResearch(id, "not mine", { db, requestId: first })).toBe(false);
    expect(await markResearching(id, { db, requestId: second })).toMatchObject({ status: "researching" });
    expect(await completeResearch(id, research(), { db, requestId: first })).toBe(false);
    expect(await completeResearch(id, research(), { db, requestId: second })).toBe(true);
  });

  it("moves queued → researching → researched, each step once", async () => {
    const id = await oneItem();
    expect(await markResearching(id, { db })).toBeNull();
    await queueForResearch([id], { requestedBy: OWNER }, { db });

    expect(await markResearching(id, { db })).toMatchObject({ id, status: "researching" });
    expect(await markResearching(id, { db })).toBeNull();

    expect(await completeResearch(id, research(), { db })).toBe(true);
    expect(await getPendingTool(id, { db })).toMatchObject({
      status: "researched",
      research: research(),
      researchError: null,
    });
    expect(await completeResearch(id, research(), { db })).toBe(false);
  });

  it("refuses to store a result that does not parse", async () => {
    const id = await oneItem();
    await setStatus(id, { status: "researching" });
    await expect(
      completeResearch(id, { ...research(), injected: "publish me" } as ResearchResult, { db })
    ).rejects.toThrow();
    expect((await getPendingTool(id, { db }))?.status).toBe("researching");
  });

  it("does not overwrite an item discarded while it was being researched", async () => {
    const id = await oneItem();
    await queueForResearch([id], { requestedBy: OWNER }, { db });
    await markResearching(id, { db });
    // A reviewer discards it mid-run (by hand — the route would refuse).
    await setStatus(id, { status: "discarded" });

    expect(await completeResearch(id, research(), { db })).toBe(false);
    expect(await failResearch(id, "too late", { db })).toBe(false);
    expect(await getPendingTool(id, { db })).toMatchObject({ status: "discarded", research: null });
  });

  it("fails a queued or researching item with a capped reason", async () => {
    const queued = await oneItem("Q");
    await queueForResearch([queued], { requestedBy: OWNER }, { db });
    expect(await failResearch(queued, "x".repeat(5000), { db })).toBe(true);
    const failed = await getPendingTool(queued, { db });
    expect(failed?.status).toBe("failed");
    expect(failed?.researchError).toHaveLength(2000);

    const identified = await oneItem("I");
    expect(await failResearch(identified, "nope", { db })).toBe(false);
  });
});

describe("expireIdentifiedPendingTools", () => {
  it("discards only identified items older than the cutoff and releases their photos", async () => {
    const cutoff = new Date("2026-09-01T00:00:00Z");
    const oldPhoto = await upload();
    const stale = await oneItem("Stale", { attachmentIds: [oldPhoto] });
    await setStatus(stale, { createdAt: new Date("2026-08-01T00:00:00Z") });
    const fresh = await oneItem("Fresh");
    await setStatus(fresh, { createdAt: new Date("2026-09-10T00:00:00Z") });
    const researched = await oneItem("Researched");
    await setStatus(researched, { status: "researched", createdAt: new Date("2026-08-01T00:00:00Z") });

    const result = await expireIdentifiedPendingTools(cutoff, { db });

    expect(result).toEqual({ discarded: [stale], releasedAttachments: 1 });
    expect((await getPendingTool(stale, { db }))?.status).toBe("discarded");
    expect((await getPendingTool(fresh, { db }))?.status).toBe("identified");
    expect((await getPendingTool(researched, { db }))?.status).toBe("researched");
    const [photo] = await db.select().from(attachments).where(eq(attachments.id, oldPhoto));
    expect(photo.ownerId).toBeNull();
  });

  it("does nothing when nothing is stale", async () => {
    await oneItem();
    expect(await expireIdentifiedPendingTools(new Date("2000-01-01"), { db })).toEqual({
      discarded: [],
      releasedAttachments: 0,
    });
  });
});

describe("deleteDiscardedPendingTools", () => {
  it("deletes discarded items older than the cutoff and releases anything they still hold", async () => {
    const cutoff = new Date("2026-09-01T00:00:00Z");
    const photo = await upload();
    const old = await oneItem("Old", { attachmentIds: [photo] });
    const recent = await oneItem("Recent");
    const open = await oneItem("Open");
    const later = await oneItem("Later");
    await db
      .update(pendingTools)
      .set({ status: "discarded" })
      .where(eq(pendingTools.id, old));
    await db.update(pendingTools).set({ status: "discarded" }).where(eq(pendingTools.id, recent));
    // The trigger stamps updated_at on every update; set the age last, and
    // with the trigger's own clock out of the way.
    await db.execute(sql`alter table pending_tools disable trigger pending_tools_set_updated_at`);
    await db.update(pendingTools).set({ updatedAt: new Date("2026-08-01T00:00:00Z") }).where(eq(pendingTools.id, old));
    await db.update(pendingTools).set({ updatedAt: new Date("2026-08-01T00:00:00Z") }).where(eq(pendingTools.id, open));
    await db.update(pendingTools).set({ updatedAt: new Date("2026-09-10T00:00:00Z") }).where(eq(pendingTools.id, recent));
    await db.execute(sql`alter table pending_tools enable trigger pending_tools_set_updated_at`);

    expect(await deleteDiscardedPendingTools(cutoff, { db })).toEqual({ deleted: 1, releasedAttachments: 1 });
    expect(await getPendingTool(old, { db })).toBeNull();
    expect((await getPendingTool(recent, { db }))?.status).toBe("discarded");
    expect((await getPendingTool(open, { db }))?.status).toBe("identified");
    expect((await getPendingTool(later, { db }))?.status).toBe("identified");
    const [released] = await db.select().from(attachments).where(eq(attachments.id, photo));
    expect(released.ownerId).toBeNull();
  });
});

describe("releasePhotosOfMissingPendingTools", () => {
  it("releases photos whose pending item is gone — a removed person's items cascade — and no others", async () => {
    await db.insert(user).values({ id: "leaving", name: "Leaving", email: "leaving@cornell.edu" });
    const theirPhoto = await upload({ uploadedBy: "leaving" });
    const batch = await createPendingBatch(
      { createdBy: "leaving", items: [{ name: "Leaving printer", attachmentIds: [theirPhoto] }] },
      { db }
    );
    expect(batch.items[0].photosAttached).toBe(1);
    const keptPhoto = await upload();
    await oneItem("Staying", { attachmentIds: [keptPhoto] });

    await db.delete(user).where(eq(user.id, "leaving"));
    expect(await getPendingTool(batch.items[0].id, { db })).toBeNull();

    expect(await releasePhotosOfMissingPendingTools({ db })).toBe(1);
    const [released] = await db.select().from(attachments).where(eq(attachments.id, theirPhoto));
    expect(released).toMatchObject({ ownerType: null, ownerId: null });
    const [kept] = await db.select().from(attachments).where(eq(attachments.id, keptPhoto));
    expect(kept.ownerType).toBe("pending_tool");
  });
});

describe("listIntakeQueue", () => {
  it("lists every open item however many settled ones are newer, and caps only the settled", async () => {
    const waiting = await oneItem("Waiting");
    await setStatus(waiting, { status: "researched", createdAt: new Date("2026-01-01T00:00:00Z") });
    for (let i = 0; i < 4; i += 1) {
      const settled = await oneItem(`Settled ${i}`);
      await setStatus(settled, { status: i % 2 ? "approved" : "discarded" });
    }

    const queue = await listIntakeQueue({ settledLimit: 2 }, { db });
    expect(queue.map((item) => item.id)).toContain(waiting);
    expect(queue.filter((item) => item.status === "approved" || item.status === "discarded")).toHaveLength(2);
    // The single capped read this replaces loses the waiting item.
    expect((await listPendingTools({ limit: 2 }, { db })).map((item) => item.id)).not.toContain(waiting);
  });
});
