// @vitest-environment node

/**
 * `mirrorPush` and `mirrorPushAfterChange` as plain functions (spec §10, the
 * 2026-09-22 amendment). Without the workflow compiler `"use workflow"` and
 * `"use step"` are only strings, so the steps module and `sleep` are mocked
 * and the orchestration is what is under test: rounds while a push runs out
 * of budget, the cap, the sleep before a coalesced push, and the same calls
 * in the same order every time — which is what a replay needs.
 */

const log = vi.hoisted(() => [] as string[]);

const steps = vi.hoisted(() => ({
  pushMirrorRound: vi.fn(),
  takeCoalescedMirrors: vi.fn(),
  finishMirrorPush: vi.fn(),
}));

const wf = vi.hoisted(() => ({ sleep: vi.fn() }));

vi.mock("../lib/mirror/steps", () => steps);
vi.mock("workflow", () => ({ sleep: wf.sleep }));

import { MIRROR_BUSY_PAUSE, MIRROR_BUSY_RETRIES, MIRROR_COALESCE_DELAY, MIRROR_MAX_ROUNDS } from "../lib/mirror/limits";
import type { MirrorPushOutcome } from "../lib/mirror/push";
import { mirrorPush, mirrorPushAfterChange } from "./mirror-push";

const ERROR = { code: "rows_failed" as const, entities: ["tools" as const], failed: 1, detail: null };

const INCOMPLETE: MirrorPushOutcome = { state: "incomplete", pushed: 40, archived: 1 };
const OK: MirrorPushOutcome = { state: "ok", pushed: 3, archived: 0 };

/** Each call to `pushMirrorRound(id)` answers the next outcome queued for that id. */
function rounds(plan: Record<string, MirrorPushOutcome[]>) {
  const queues = new Map(Object.entries(plan).map(([id, outcomes]) => [id, [...outcomes]]));
  steps.pushMirrorRound.mockImplementation(async (id: string) => {
    log.push(`push:${id}`);
    const next = queues.get(id)?.shift();
    if (!next) throw new Error(`no outcome planned for ${id}`);
    return next;
  });
}

beforeEach(() => {
  log.length = 0;
  for (const fn of Object.values(steps)) fn.mockReset();
  wf.sleep.mockReset().mockImplementation(async (duration: string) => {
    log.push(`sleep:${duration}`);
  });
  steps.finishMirrorPush.mockImplementation(async () => {
    log.push("finish");
  });
});

describe("mirrorPush", () => {
  it("runs another round while a push is incomplete, pausing between rounds, and stops at ok", async () => {
    rounds({ m1: [INCOMPLETE, INCOMPLETE, OK] });

    expect(await mirrorPush("m1")).toEqual({
      mirrorId: "m1",
      rounds: 3,
      state: "ok",
      pushed: 83,
      archived: 2,
      failed: 0,
    });
    expect(log).toEqual(["push:m1", "sleep:5s", "push:m1", "sleep:5s", "push:m1", "finish"]);
    expect(steps.finishMirrorPush).toHaveBeenCalledWith("run", [expect.objectContaining({ mirrorId: "m1", state: "ok" })]);
  });

  it.each<[string, MirrorPushOutcome]>([
    ["ok", OK],
    ["partial", { state: "partial", pushed: 5, archived: 0, failed: 1, error: ERROR }],
    ["failed", { state: "failed", error: { ...ERROR, code: "unauthorized" }, paused: true }],
    ["skipped", { state: "skipped", reason: "paused" }],
  ])("stops after one round that ends %s", async (state, outcome) => {
    rounds({ m1: [outcome, OK] });

    const summary = await mirrorPush("m1");

    expect(summary.rounds).toBe(1);
    expect(summary.state).toBe(state);
    expect(steps.pushMirrorRound).toHaveBeenCalledTimes(1);
    expect(wf.sleep).not.toHaveBeenCalled();
  });

  it("waits out another push that holds the mirror, then pushes, without spending a round", async () => {
    const BUSY: MirrorPushOutcome = { state: "skipped", reason: "running" };
    rounds({ m1: [BUSY, BUSY, INCOMPLETE, OK] });

    expect(await mirrorPush("m1")).toMatchObject({ rounds: 4, state: "ok", pushed: 43 });
    expect(log).toEqual([
      "push:m1",
      `sleep:${MIRROR_BUSY_PAUSE}`,
      "push:m1",
      `sleep:${MIRROR_BUSY_PAUSE}`,
      "push:m1",
      "sleep:5s",
      "push:m1",
      "finish",
    ]);
  });

  it(`gives up as skipped after ${MIRROR_BUSY_RETRIES} waits for a push that never finishes`, async () => {
    rounds({ m1: Array.from({ length: MIRROR_BUSY_RETRIES + 3 }, () => ({ state: "skipped", reason: "running" }) as const) });

    expect(await mirrorPush("m1")).toMatchObject({ rounds: MIRROR_BUSY_RETRIES + 1, state: "skipped" });
    expect(wf.sleep).toHaveBeenCalledTimes(MIRROR_BUSY_RETRIES);
  });

  it("counts the failed rows of a partial round after incomplete ones", async () => {
    rounds({ m1: [INCOMPLETE, { state: "partial", pushed: 2, archived: 0, failed: 3, error: ERROR }] });
    expect(await mirrorPush("m1")).toMatchObject({ rounds: 2, state: "partial", pushed: 42, failed: 3 });
  });

  it(`stops after ${MIRROR_MAX_ROUNDS} rounds even when every one is incomplete`, async () => {
    rounds({ m1: Array.from({ length: MIRROR_MAX_ROUNDS + 3 }, () => INCOMPLETE) });

    const summary = await mirrorPush("m1");

    expect(summary).toMatchObject({ rounds: MIRROR_MAX_ROUNDS, state: "incomplete" });
    expect(steps.pushMirrorRound).toHaveBeenCalledTimes(MIRROR_MAX_ROUNDS);
    expect(wf.sleep).toHaveBeenCalledTimes(MIRROR_MAX_ROUNDS - 1);
  });

  it("ends as error, and still logs, when a round throws after its retries", async () => {
    steps.pushMirrorRound.mockRejectedValue(new Error("Mirror push: the database could not be reached."));

    expect(await mirrorPush("m1")).toMatchObject({ rounds: 1, state: "error" });
    expect(steps.finishMirrorPush).toHaveBeenCalledWith("run", [expect.objectContaining({ state: "error" })]);
  });
});

describe("mirrorPushAfterChange", () => {
  it("sleeps first, then takes the waiting mirrors and pushes each in order", async () => {
    steps.takeCoalescedMirrors.mockImplementation(async () => {
      log.push("take");
      return ["m1", "m2", "m3"];
    });
    rounds({ m1: [OK], m2: [INCOMPLETE, OK], m3: [{ state: "skipped", reason: "paused" }] });

    const result = await mirrorPushAfterChange();

    expect(log).toEqual([
      `sleep:${MIRROR_COALESCE_DELAY}`,
      "take",
      "push:m1",
      "push:m2",
      "sleep:5s",
      "push:m2",
      "push:m3",
      "finish",
    ]);
    expect(result.mirrors.map((m) => [m.mirrorId, m.state, m.rounds])).toEqual([
      ["m1", "ok", 1],
      ["m2", "ok", 2],
      ["m3", "skipped", 1],
    ]);
    expect(steps.finishMirrorPush).toHaveBeenCalledWith("change", result.mirrors);
  });

  it("honours an explicit delay", async () => {
    steps.takeCoalescedMirrors.mockResolvedValue([]);
    await mirrorPushAfterChange("30s");
    expect(wf.sleep).toHaveBeenCalledWith("30s");
  });

  it("pushes the next mirror when one throws", async () => {
    steps.takeCoalescedMirrors.mockResolvedValue(["m1", "m2"]);
    steps.pushMirrorRound.mockImplementation(async (id: string) => {
      if (id === "m1") throw new Error("boom");
      return OK;
    });

    const result = await mirrorPushAfterChange();

    expect(result.mirrors.map((m) => m.state)).toEqual(["error", "ok"]);
  });

  it("pushes nothing when nothing is waiting", async () => {
    steps.takeCoalescedMirrors.mockResolvedValue([]);
    expect(await mirrorPushAfterChange()).toEqual({ mirrors: [] });
    expect(steps.pushMirrorRound).not.toHaveBeenCalled();
    expect(steps.finishMirrorPush).toHaveBeenCalledWith("change", []);
  });

  it("issues the same calls in the same order every run", async () => {
    const plan = { m1: [INCOMPLETE, OK], m2: [OK] };
    steps.takeCoalescedMirrors.mockResolvedValue(["m1", "m2"]);
    rounds(plan);
    await mirrorPushAfterChange();
    const first = [...log];

    log.length = 0;
    rounds(plan);
    await mirrorPushAfterChange();

    expect(log).toEqual(first);
  });
});
