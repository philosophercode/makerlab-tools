// @vitest-environment node
import { FatalError, RetryableError } from "workflow";

/**
 * The mirror's steps called directly (spec §10 "Workflow steps, called
 * directly"). `pushMirror` is mocked — it has its own tests against the fake
 * Notion — so what is under test is how a step treats a throw: the database
 * having a bad minute is retried, anything else is fatal so a bug does not
 * burn attempts, and nothing token- or email-shaped survives into the message.
 */

const deps = vi.hoisted(() => ({ pushMirror: vi.fn(), takeCoalescedPush: vi.fn() }));

vi.mock("./push", () => ({ pushMirror: deps.pushMirror }));
vi.mock("../data/mirrors", () => ({ takeCoalescedPush: deps.takeCoalescedPush }));

import { DbUnavailableError } from "../db/client";
import { MIRROR_STEP_MAX_RETRIES } from "./limits";
import { finishMirrorPush, pushMirrorRound, takeCoalescedMirrors } from "./steps";

const MIRROR = "7a1c9a64-6a3b-4c8e-9d2f-0b1e2c3d4e5f";

beforeEach(() => {
  deps.pushMirror.mockReset();
  deps.takeCoalescedPush.mockReset();
});

async function thrownBy(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the step to throw");
}

describe("pushMirrorRound", () => {
  it("returns pushMirror's outcome unchanged", async () => {
    deps.pushMirror.mockResolvedValue({ state: "incomplete", pushed: 12, archived: 0 });
    expect(await pushMirrorRound(MIRROR)).toEqual({ state: "incomplete", pushed: 12, archived: 0 });
    expect(deps.pushMirror).toHaveBeenCalledWith(MIRROR);
  });

  it(`carries maxRetries = ${MIRROR_STEP_MAX_RETRIES} as a property, where the SDK reads it`, () => {
    expect(pushMirrorRound.maxRetries).toBe(MIRROR_STEP_MAX_RETRIES);
    expect(takeCoalescedMirrors.maxRetries).toBe(MIRROR_STEP_MAX_RETRIES);
  });

  it.each<[string, unknown]>([
    ["DbUnavailableError", new DbUnavailableError(new Error("getaddrinfo ENOTFOUND"))],
    ["a refused socket", Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" })],
    ["a dropped connection", new Error("Connection terminated unexpectedly")],
    ["an admin shutdown (57P01)", Object.assign(new Error("terminating connection due to administrator command"), { code: "57P01" })],
    ["a connection exception (08006)", Object.assign(new Error("connection failure"), { code: "08006" })],
    ["a driver error wrapped by drizzle", new Error("Failed query: select 1", { cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }) })],
    ["Neon's HTTP driver failing to fetch", Object.assign(new Error("Error connecting to database"), { sourceError: new TypeError("fetch failed") })],
  ])("retries %s a minute later", async (_label, error) => {
    deps.pushMirror.mockRejectedValue(error);

    const thrown = await thrownBy(pushMirrorRound(MIRROR));

    expect(RetryableError.is(thrown)).toBe(true);
    expect((thrown as RetryableError).message).toBe("Mirror push: the database could not be reached.");
    // "1m" — a Date one minute out, however the SDK normalises it.
    const retryAfter = (thrown as RetryableError).retryAfter;
    expect(retryAfter).toBeInstanceOf(Date);
    const delta = (retryAfter as Date).getTime() - Date.now();
    expect(delta).toBeGreaterThan(50_000);
    expect(delta).toBeLessThanOrEqual(60_000);
  });

  it.each<[string, unknown]>([
    ["a bug", new TypeError("Cannot read properties of undefined (reading 'id')")],
    ["a constraint violation", Object.assign(new Error('violates check constraint "mirror_pages_entity_check"'), { code: "23514" })],
    ["a thrown string", "nope"],
  ])("fails %s at once, so a bug does not burn retries", async (_label, error) => {
    deps.pushMirror.mockRejectedValue(error);

    const thrown = await thrownBy(pushMirrorRound(MIRROR));

    expect(FatalError.is(thrown)).toBe(true);
    expect((thrown as Error).message).toMatch(/^Mirror push: /);
  });

  it("scrubs anything token- or email-shaped out of a fatal message", async () => {
    deps.pushMirror.mockRejectedValue(
      new Error("Failed query: insert … params: ntn_abcdefghijklmnop1234, casey@cornell.edu, secret_ZYXWVUT98765")
    );

    const message = (await thrownBy(pushMirrorRound(MIRROR)) as Error).message;

    expect(message).not.toContain("ntn_abcdefghijklmnop1234");
    expect(message).not.toContain("secret_ZYXWVUT98765");
    expect(message).not.toContain("casey@cornell.edu");
  });

  it("passes an already-classified error through", async () => {
    const fatal = new FatalError("already decided");
    deps.pushMirror.mockRejectedValue(fatal);
    expect(await thrownBy(pushMirrorRound(MIRROR))).toBe(fatal);
  });
});

describe("takeCoalescedMirrors", () => {
  it("returns the ids takeCoalescedPush cleared", async () => {
    deps.takeCoalescedPush.mockResolvedValue([MIRROR]);
    expect(await takeCoalescedMirrors()).toEqual([MIRROR]);
  });

  it("retries the database being unreachable", async () => {
    deps.takeCoalescedPush.mockRejectedValue(new DbUnavailableError(new Error("down")));
    expect(RetryableError.is(await thrownBy(takeCoalescedMirrors()))).toBe(true);
  });
});

describe("finishMirrorPush", () => {
  it("logs one line of ids and counts, and nothing else", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await finishMirrorPush("change", [
      { mirrorId: MIRROR, rounds: 2, state: "ok", pushed: 41, archived: 1, failed: 0 },
      { mirrorId: "m2", rounds: 1, state: "partial", pushed: 3, archived: 0, failed: 2 },
    ]);

    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]).toEqual([
      `[mirror] change push finished: mirrors=2; ${MIRROR} rounds=2 state=ok pushed=41 archived=1 failed=0; m2 rounds=1 state=partial pushed=3 archived=0 failed=2`,
    ]);
  });
});
