// @vitest-environment node
import { eq } from "drizzle-orm";
import { createPgliteDb } from "../db/pglite";
import { researchRequests, toolPhotoSearches, tools, user } from "../db/schema/index";
import type { Db } from "../db/types";
import type { PhotoOption } from "../photo-options/types";
import { PHOTO_SEARCH_STALE_MS } from "../photo-options/types";
import {
  failPhotoSearch,
  finishPhotoSearch,
  getPhotoSearch,
  latestPhotoSearch,
  recordPhotoChoice,
  shownPhotoUrls,
  startPhotoSearch,
} from "./photo-searches";
import { countResearchRequestedSince } from "./pending-tools";

/**
 * `tool_photo_searches` against an in-process Postgres (photo options spec
 * 2026-10-29 §3.1, §4): one search running per tool, the allowance charged
 * under the research lock, and a run's answer written only while it runs.
 */

let db: Db;
let toolId: string;
const OWNER = "photo-owner";
const SINCE = () => new Date(Date.now() - 86_400_000);

const OPTION: PhotoOption = {
  url: "https://www.prusa3d.com/img/mk4s.png",
  pageUrl: "https://www.prusa3d.com/product/prusa-mk4s/",
  source: "og",
  width: 1200,
  height: 900,
  contentType: "image/png",
  reason: "the whole printer from the front",
  manufacturer: true,
};

beforeAll(async () => {
  db = await createPgliteDb();
  await db.insert(user).values({ id: OWNER, name: "Isaac", email: "photos@cornell.edu" });
});

beforeEach(async () => {
  await db.delete(researchRequests);
  await db.delete(toolPhotoSearches);
  await db.delete(tools);
  const [row] = await db.insert(tools).values({ slug: "prusa-mk4s", name: "Prusa MK4S" }).returning({ id: tools.id });
  toolId = row.id;
});

function start(limit = 100, now?: Date) {
  return startPhotoSearch(toolId, { requestedBy: OWNER, note: null, limit, since: SINCE(), now }, { db });
}

describe("startPhotoSearch", () => {
  it("writes a searching row and charges one research item", async () => {
    const result = await start();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await countResearchRequestedSince(OWNER, SINCE(), { db })).toBe(1);
    const view = await latestPhotoSearch(toolId, { db });
    expect(view).toMatchObject({ id: result.searchId, status: "searching", running: true, options: [] });
  });

  it("refuses a second search while one runs, and charges nothing for it", async () => {
    await start();
    expect(await start()).toEqual({ ok: false, reason: "photo_search_running" });
    expect(await countResearchRequestedSince(OWNER, SINCE(), { db })).toBe(1);
  });

  it("closes a stale search so the button works again", async () => {
    const old = await start(100, new Date(Date.now() - PHOTO_SEARCH_STALE_MS - 60_000));
    const fresh = await start();
    expect(fresh.ok).toBe(true);
    if (!old.ok) throw new Error("expected the first to start");
    expect((await getPhotoSearch(old.searchId, { db }))?.status).toBe("failed");
  });

  it("refuses past the daily allowance", async () => {
    expect(await start(0)).toEqual({ ok: false, reason: "daily_limit", remaining: 0 });
    expect(await db.select().from(toolPhotoSearches)).toHaveLength(0);
  });

  it("answers not_found for a tool that is not there", async () => {
    expect(await startPhotoSearch(crypto.randomUUID(), { requestedBy: OWNER, note: null, limit: 100, since: SINCE() }, { db })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});

describe("finishing and failing", () => {
  it("writes the options once, only while searching", async () => {
    const started = await start();
    if (!started.ok) throw new Error("expected a start");
    expect(await finishPhotoSearch(started.searchId, [OPTION], { db })).toBe(true);
    expect(await failPhotoSearch(started.searchId, "late", { db })).toBe(false);
    const view = await latestPhotoSearch(toolId, { db });
    expect(view).toMatchObject({ status: "ready", running: false, options: [OPTION], error: null });
  });

  it("records a failure with its reason", async () => {
    const started = await start();
    if (!started.ok) throw new Error("expected a start");
    await failPhotoSearch(started.searchId, "No new picture of it was found.", { db });
    expect(await latestPhotoSearch(toolId, { db })).toMatchObject({ status: "failed", error: "No new picture of it was found." });
  });
});

describe("shownPhotoUrls and recordPhotoChoice", () => {
  it("lists what earlier searches offered, except the one named", async () => {
    const first = await start();
    if (!first.ok) throw new Error("expected a start");
    await finishPhotoSearch(first.searchId, [OPTION], { db });
    const second = await start();
    if (!second.ok) throw new Error("expected a start");

    expect(await shownPhotoUrls(toolId, { db, except: second.searchId })).toEqual([OPTION.url]);
    expect(await shownPhotoUrls(toolId, { db, except: first.searchId })).toEqual([]);
  });

  it("records the pick on the search", async () => {
    const started = await start();
    if (!started.ok) throw new Error("expected a start");
    await finishPhotoSearch(started.searchId, [OPTION], { db });
    await recordPhotoChoice(started.searchId, OPTION.url, OWNER, { db });
    const [row] = await db.select().from(toolPhotoSearches).where(eq(toolPhotoSearches.id, started.searchId));
    expect(row).toMatchObject({ chosenUrl: OPTION.url, chosenBy: OWNER });
    expect((await latestPhotoSearch(toolId, { db }))?.chosenUrl).toBe(OPTION.url);
  });
});
