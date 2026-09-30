// @vitest-environment node

/**
 * Starting the mirror's workflows, against PGlite (spec §3.8, §8 "Sync now:
 * one push per mirror per 15 minutes").
 *
 * `start` is mocked — the workflow tier has its own test — and so is the
 * workflow module, so what is under test is the contract around the start:
 * the database claim that enforces the fifteen minutes, the refusals, and
 * that a start that fails gives the claim back.
 */

const wf = vi.hoisted(() => ({
  start: vi.fn(),
  mirrorPush: Object.assign(async () => ({}), { workflowId: "mirror-push" }),
  mirrorPushAfterChange: Object.assign(async () => ({ mirrors: [] }), { workflowId: "mirror-push-after-change" }),
}));

vi.mock("workflow/api", () => ({ start: wf.start }));
vi.mock("../../workflows/mirror-push", () => ({
  mirrorPush: wf.mirrorPush,
  mirrorPushAfterChange: wf.mirrorPushAfterChange,
}));

import { sql } from "drizzle-orm";
import { getMirror, saveMirrorConnection, setMirrorMapping, setMirrorPaused, disconnectMirror } from "../data/mirrors";
import { createPgliteDb } from "../db/pglite";
import { notionMirrors, user } from "../db/schema/index";
import type { Db } from "../db/types";
import { startCoalescedPush, startMirrorPush, syncMirrorNow } from "./start";

const PAGE = "0f5e4a3c-1111-2222-3333-444455556666";
const TOKEN_BYTES = new Uint8Array([1, 2, 3, 4]);

let db: Db;
let owner: string;
let mirrorId: string;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  wf.start.mockReset().mockResolvedValue({ runId: "run-1" });
  await db.delete(notionMirrors);
  owner = `u-${crypto.randomUUID()}`;
  await db.insert(user).values({ id: owner, name: "Mirror Owner", email: `${owner}@example.test`, role: "admin" });
  const { mirror } = await saveMirrorConnection(
    { ownerUserId: owner, tokenCiphertext: TOKEN_BYTES, parentPageId: PAGE, parentPageTitle: "Mirror" },
    { db }
  );
  mirrorId = mirror.id;
  await setMirrorMapping(mirrorId, { tools: "b1a2c3d4-0000-4000-8000-000000000001" }, { db });
});

describe("startMirrorPush", () => {
  it("starts mirrorPush with the mirror id and answers the run id", async () => {
    expect(await startMirrorPush(mirrorId)).toEqual({ ok: true, runId: "run-1" });
    expect(wf.start).toHaveBeenCalledWith(wf.mirrorPush, [mirrorId]);
  });

  it("answers ok: false, not a throw, when the workflow cannot be started", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    wf.start.mockRejectedValue(new Error("world unavailable"));
    expect(await startMirrorPush(mirrorId)).toEqual({ ok: false });
  });
});

describe("syncMirrorNow", () => {
  it("starts once, then refuses a second press within fifteen minutes with the seconds left", async () => {
    expect(await syncMirrorNow(owner, { db })).toEqual({ ok: true });
    expect(wf.start).toHaveBeenCalledTimes(1);
    expect(wf.start).toHaveBeenCalledWith(wf.mirrorPush, [mirrorId]);

    const second = await syncMirrorNow(owner, { db });

    expect(second).toMatchObject({ ok: false, code: "sync_too_soon" });
    if (second.ok) throw new Error("unreachable");
    expect(second.retryAfterSeconds).toBeGreaterThan(14 * 60);
    expect(second.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
    expect(wf.start).toHaveBeenCalledTimes(1);
  });

  it("refuses as sync_running while another push holds the mirror, starts nothing, and keeps the window open", async () => {
    await db.execute(sql`update notion_mirrors set running_since = now() where id = ${mirrorId}`);

    expect(await syncMirrorNow(owner, { db })).toEqual({ ok: false, code: "sync_running" });
    expect(wf.start).not.toHaveBeenCalled();
    expect((await getMirror(mirrorId, { db }))?.syncRequestedAt).toBeNull();

    await db.execute(sql`update notion_mirrors set running_since = null where id = ${mirrorId}`);
    expect(await syncMirrorNow(owner, { db })).toEqual({ ok: true });
  });

  it("allows it again once the window has passed", async () => {
    expect(await syncMirrorNow(owner, { db })).toEqual({ ok: true });
    await db.execute(sql`update notion_mirrors set sync_requested_at = now() - interval '16 minutes' where id = ${mirrorId}`);
    expect(await syncMirrorNow(owner, { db })).toEqual({ ok: true });
    expect(wf.start).toHaveBeenCalledTimes(2);
  });

  it("gives the claim back when the start fails, so an immediate retry is allowed", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    wf.start.mockRejectedValueOnce(new Error("world unavailable"));

    expect(await syncMirrorNow(owner, { db })).toEqual({ ok: false, code: "start_failed" });
    expect((await getMirror(mirrorId, { db }))?.syncRequestedAt).toBeNull();
    expect(error).toHaveBeenCalled();

    expect(await syncMirrorNow(owner, { db })).toEqual({ ok: true });
    expect(wf.start).toHaveBeenCalledTimes(2);
  });

  it("refuses a paused mirror, and starts nothing", async () => {
    await setMirrorPaused(owner, true, { db });
    expect(await syncMirrorNow(owner, { db })).toEqual({ ok: false, code: "mirror_paused" });
    expect(wf.start).not.toHaveBeenCalled();
  });

  it("refuses a disconnected mirror as not connected", async () => {
    await disconnectMirror(owner, { db });
    expect(await syncMirrorNow(owner, { db })).toEqual({ ok: false, code: "not_connected" });
    expect(wf.start).not.toHaveBeenCalled();
  });

  it("refuses somebody with no mirror at all as not connected", async () => {
    expect(await syncMirrorNow("u-nobody", { db })).toEqual({ ok: false, code: "not_connected" });
    expect(wf.start).not.toHaveBeenCalled();
  });

  it("refuses a mirror with nothing mapped", async () => {
    await setMirrorMapping(mirrorId, {}, { db });
    expect(await syncMirrorNow(owner, { db })).toEqual({ ok: false, code: "not_mapped" });
    expect(wf.start).not.toHaveBeenCalled();
  });
});

describe("startCoalescedPush", () => {
  it("starts mirrorPushAfterChange with no arguments, so it sleeps the default delay", async () => {
    expect(await startCoalescedPush()).toBe(true);
    expect(wf.start).toHaveBeenCalledWith(wf.mirrorPushAfterChange, []);
  });

  it("answers false when the workflow cannot be started", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    wf.start.mockRejectedValue(new Error("world unavailable"));
    expect(await startCoalescedPush()).toBe(false);
  });
});
