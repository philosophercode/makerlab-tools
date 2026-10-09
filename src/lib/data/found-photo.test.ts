// @vitest-environment node
import { eq } from "drizzle-orm";
import { createPgliteDb } from "../db/pglite";
import { pendingTools, researchRequests, user } from "../db/schema/index";
import type { Db } from "../db/types";
import type { ImageCandidate } from "../research/result";
import { failFoundPhoto, finishFoundPhoto, foundPhotoLedgerRows, startFoundPhotoSearch } from "./found-photo";
import { countResearchRequestedSince, createPendingBatch, getPendingTool } from "./pending-tools";

/**
 * `pending_tools.found_photo` against an in-process Postgres (data platform
 * spec amendment "A photo for a name"): marking lookups and charging a quarter
 * item each under the research lock, and the run's answer written only while
 * it is still that run's.
 */

let db: Db;
const OWNER = "found-owner";
const SINCE = () => new Date(Date.now() - 86_400_000);

const CANDIDATE: ImageCandidate = {
  url: "https://cdn.maker.example/img/front.png",
  pageUrl: "https://www.maker.example/p",
  source: "exa",
  width: 1200,
  height: 900,
  contentType: "image/png",
  rank: 1,
  reason: "the whole machine from the front",
};

beforeAll(async () => {
  db = await createPgliteDb();
  await db.insert(user).values({ id: OWNER, name: "Isaac", email: "found@cornell.edu" });
});

beforeEach(async () => {
  await db.delete(researchRequests);
  await db.delete(pendingTools);
});

async function items(names: string[]): Promise<string[]> {
  const batch = await createPendingBatch({ createdBy: OWNER, items: names.map((name) => ({ name })) }, { db });
  return batch.items.map((item) => item.id);
}

describe("foundPhotoLedgerRows", () => {
  it("charges a quarter item each, rounded up", () => {
    expect([0, 1, 4, 5, 10].map(foundPhotoLedgerRows)).toEqual([0, 1, 1, 2, 3]);
  });
});

describe("startFoundPhotoSearch", () => {
  it("marks the items searching under one request and charges the allowance a quarter item each", async () => {
    const ids = await items(["Bambu Lab X1-Carbon", "Prusa MK4S", "Glowforge Pro", "Formlabs Form 4", "Dremel 3000"]);
    const requestId = crypto.randomUUID();
    const result = await startFoundPhotoSearch(ids, { requestedBy: OWNER, requestId, limit: 100, since: SINCE() }, { db });

    expect(result).toEqual({ started: ids, unaffordable: 0, charged: 2 });
    for (const id of ids) {
      expect((await getPendingTool(id, { db }))?.foundPhoto).toMatchObject({ requestId, status: "searching", candidate: null, cleaned: null });
    }
    expect(await countResearchRequestedSince(OWNER, SINCE(), { db })).toBe(2);
  });

  it("looks up only as many as the allowance covers, and nothing twice", async () => {
    const ids = await items(["Bambu Lab X1-Carbon", "Prusa MK4S", "Glowforge Pro", "Formlabs Form 4", "Dremel 3000", "Makita Router"]);
    // 99 of 100 spent: one ledger row left — four lookups.
    await db.insert(researchRequests).values(Array.from({ length: 99 }, () => ({ requestId: crypto.randomUUID(), userId: OWNER })));
    const first = await startFoundPhotoSearch(ids, { requestedBy: OWNER, requestId: crypto.randomUUID(), limit: 100, since: SINCE() }, { db });
    expect(first).toEqual({ started: ids.slice(0, 4), unaffordable: 2, charged: 1 });

    const again = await startFoundPhotoSearch(ids.slice(0, 4), { requestedBy: OWNER, requestId: crypto.randomUUID(), limit: 200, since: SINCE() }, { db });
    expect(again).toEqual({ started: [], unaffordable: 0, charged: 0 });
  });

  it("leaves an item that is no longer identified alone", async () => {
    const [id] = await items(["Prusa MK4S"]);
    await db.update(pendingTools).set({ status: "queued" }).where(eq(pendingTools.id, id));
    const result = await startFoundPhotoSearch([id], { requestedBy: OWNER, requestId: crypto.randomUUID(), limit: 100, since: SINCE() }, { db });
    expect(result.started).toEqual([]);
  });
});

describe("finishFoundPhoto and failFoundPhoto", () => {
  async function searching(): Promise<{ id: string; requestId: string }> {
    const [id] = await items(["Bambu Lab X2D"]);
    const requestId = crypto.randomUUID();
    await startFoundPhotoSearch([id], { requestedBy: OWNER, requestId, limit: 100, since: SINCE() }, { db });
    return { id, requestId };
  }

  it("writes the answer for this request, once", async () => {
    const { id, requestId } = await searching();
    const cleaned = { attachmentId: crypto.randomUUID(), fromUrl: CANDIDATE.url };
    expect(await finishFoundPhoto(id, requestId, { status: "found", candidate: CANDIDATE, cleaned, cleanNote: null }, { db })).toBe(true);
    expect((await getPendingTool(id, { db }))?.foundPhoto).toMatchObject({ status: "found", candidate: CANDIDATE, cleaned, error: null });
    // Landed: a second answer, or a failure, changes nothing.
    expect(await failFoundPhoto(id, requestId, "late", { db })).toBe(false);
    expect((await getPendingTool(id, { db }))?.foundPhoto?.status).toBe("found");
  });

  it("writes nothing for another request, or for an item discarded meanwhile", async () => {
    const { id, requestId } = await searching();
    expect(await finishFoundPhoto(id, crypto.randomUUID(), { status: "none", candidate: null, cleaned: null }, { db })).toBe(false);
    await db.update(pendingTools).set({ status: "discarded" }).where(eq(pendingTools.id, id));
    expect(await finishFoundPhoto(id, requestId, { status: "none", candidate: null, cleaned: null }, { db })).toBe(false);
  });

  it("records a failure as one line", async () => {
    const { id, requestId } = await searching();
    expect(await failFoundPhoto(id, requestId, "Image search:\n  the model provider is unavailable.", { db })).toBe(true);
    expect((await getPendingTool(id, { db }))?.foundPhoto).toMatchObject({
      status: "failed",
      error: "Image search: the model provider is unavailable.",
    });
  });
});
