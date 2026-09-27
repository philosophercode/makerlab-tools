// @vitest-environment node

/**
 * `requestMirrorPush()` against PGlite (spec §3.8 trigger 1).
 *
 * `start.ts` is mocked with a factory that counts how often it is loaded, so
 * the first test can prove the path every deployment without a mirror takes:
 * one query, and the workflow runtime never loaded. The rest prove the
 * coalescing — a burst of changes starts one run — and that nothing here ever
 * throws into the write that called it.
 */

const starter = vi.hoisted(() => ({ loads: 0, startCoalescedPush: vi.fn() }));

vi.mock("./start", () => {
  starter.loads += 1;
  return { startCoalescedPush: starter.startCoalescedPush };
});

import { sql } from "drizzle-orm";
import { getMirror, saveMirrorConnection, setMirrorPaused } from "../data/mirrors";
import { createPgliteDb } from "../db/pglite";
import { notionMirrors, user } from "../db/schema/index";
import type { Db } from "../db/types";
import { requestMirrorPush } from "./trigger";

const PAGE = "0f5e4a3c-1111-2222-3333-444455556666";

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  starter.startCoalescedPush.mockReset().mockResolvedValue(true);
  await db.delete(notionMirrors);
});

async function mirror(): Promise<{ owner: string; id: string }> {
  const owner = `u-${crypto.randomUUID()}`;
  await db.insert(user).values({ id: owner, name: "Mirror Owner", email: `${owner}@example.test`, role: "admin" });
  const { mirror: created } = await saveMirrorConnection(
    { ownerUserId: owner, tokenCiphertext: new Uint8Array([1, 2, 3]), parentPageId: PAGE, parentPageTitle: null },
    { db }
  );
  return { owner, id: created.id };
}

describe("requestMirrorPush", () => {
  // Declared first on purpose: the module is loaded at most once per file.
  it("with no active mirror, neither loads start.ts nor starts anything", async () => {
    await requestMirrorPush({ db });

    const { owner } = await mirror();
    await setMirrorPaused(owner, true, { db });
    await requestMirrorPush({ db });

    expect(starter.loads).toBe(0);
    expect(starter.startCoalescedPush).not.toHaveBeenCalled();
  });

  it("with an active mirror, starts one coalesced push and leaves it claimed", async () => {
    const { id } = await mirror();

    await requestMirrorPush({ db });

    expect(starter.startCoalescedPush).toHaveBeenCalledTimes(1);
    expect((await getMirror(id, { db }))?.pushRequestedAt).not.toBeNull();
  });

  it("coalesces a burst: five changes start one run", async () => {
    await mirror();

    for (let i = 0; i < 5; i += 1) await requestMirrorPush({ db });

    expect(starter.startCoalescedPush).toHaveBeenCalledTimes(1);
  });

  it("coalesces five changes that arrive at once", async () => {
    await mirror();

    await Promise.all(Array.from({ length: 5 }, () => requestMirrorPush({ db })));

    expect(starter.startCoalescedPush).toHaveBeenCalledTimes(1);
  });

  it("claims again once the waiting push is older than the stale window", async () => {
    const { id } = await mirror();
    await requestMirrorPush({ db });
    await db.execute(sql`update notion_mirrors set push_requested_at = now() - interval '11 minutes' where id = ${id}`);

    await requestMirrorPush({ db });

    expect(starter.startCoalescedPush).toHaveBeenCalledTimes(2);
  });

  it("gives the claim back when the start fails, so the next change tries again", async () => {
    const { id } = await mirror();
    starter.startCoalescedPush.mockResolvedValueOnce(false);

    await requestMirrorPush({ db });
    expect((await getMirror(id, { db }))?.pushRequestedAt).toBeNull();

    await requestMirrorPush({ db });
    expect(starter.startCoalescedPush).toHaveBeenCalledTimes(2);
    expect((await getMirror(id, { db }))?.pushRequestedAt).not.toBeNull();
  });

  it("gives the claim back when starting throws, and does not throw itself", async () => {
    const { id } = await mirror();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    starter.startCoalescedPush.mockRejectedValueOnce(new Error("world unavailable"));

    await expect(requestMirrorPush({ db })).resolves.toBeUndefined();

    expect((await getMirror(id, { db }))?.pushRequestedAt).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("swallows a database error with one fixed line that names nothing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = Object.create(db) as Db;
    broken.update = (() => {
      throw new Error("connection terminated unexpectedly; owner casey@cornell.edu");
    }) as unknown as Db["update"];

    await expect(requestMirrorPush({ db: broken })).resolves.toBeUndefined();

    expect(starter.startCoalescedPush).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]).toEqual([
      "[mirror] could not request a mirror push; the next change or the daily backstop will retry",
    ]);
  });
});
