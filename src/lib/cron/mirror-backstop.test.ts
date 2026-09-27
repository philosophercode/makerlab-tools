// @vitest-environment node

/**
 * The daily cron's mirror stage against PGlite (spec §3.8 trigger 3, §3.9).
 * `startMirrorPush` is mocked; which mirrors are due is
 * `listMirrorsDueForBackstop`'s own test, so this proves the stage around it:
 * every due mirror gets a start, and one that cannot be started is counted
 * and does not stop the rest.
 */

const starter = vi.hoisted(() => ({ startMirrorPush: vi.fn() }));

vi.mock("../mirror/start", () => ({ startMirrorPush: starter.startMirrorPush }));

import { sql } from "drizzle-orm";
import { finishMirrorRun, saveMirrorConnection, setMirrorPaused } from "../data/mirrors";
import { createPgliteDb } from "../db/pglite";
import { notionMirrors, user } from "../db/schema/index";
import type { Db } from "../db/types";
import { runMirrorBackstop } from "./mirror-backstop";

const PAGE = "0f5e4a3c-1111-2222-3333-444455556666";

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  starter.startMirrorPush.mockReset().mockResolvedValue({ ok: true, runId: "run" });
  vi.spyOn(console, "info").mockImplementation(() => {});
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

describe("runMirrorBackstop", () => {
  it("starts nothing when there is no mirror", async () => {
    expect(await runMirrorBackstop({ db })).toEqual({ due: 0, started: 0, failed: 0 });
    expect(starter.startMirrorPush).not.toHaveBeenCalled();
  });

  it("starts a push for every due mirror, and none for a paused or up-to-date one", async () => {
    const neverSynced = await mirror();
    const paused = await mirror();
    await setMirrorPaused(paused.owner, true, { db });
    const upToDate = await mirror();
    // Synced "in the future", so no source row can be newer than it.
    await finishMirrorRun(upToDate.id, { status: "ok", error: null, advanceTo: null, pause: false, generation: 0 }, { db });
    await db.execute(sql`update notion_mirrors set last_synced_at = now() + interval '1 day' where id = ${upToDate.id}`);

    expect(await runMirrorBackstop({ db })).toEqual({ due: 1, started: 1, failed: 0 });
    expect(starter.startMirrorPush).toHaveBeenCalledWith(neverSynced.id);
    expect(starter.startMirrorPush).toHaveBeenCalledTimes(1);
  });

  it("counts a start that fails or throws, and carries on with the rest", async () => {
    await mirror();
    await mirror();
    await mirror();
    starter.startMirrorPush
      .mockResolvedValueOnce({ ok: false })
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ ok: true, runId: "run" });

    expect(await runMirrorBackstop({ db })).toEqual({ due: 3, started: 1, failed: 2 });
    expect(starter.startMirrorPush).toHaveBeenCalledTimes(3);
  });
});
