import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn<(task: () => unknown) => void>(),
  requestMirrorPush: vi.fn<() => Promise<void>>(),
}));

vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("./trigger", () => ({ requestMirrorPush: mocks.requestMirrorPush }));

import { requestMirrorPushAfterResponse } from "./after-response";

beforeEach(() => {
  mocks.after.mockReset();
  mocks.requestMirrorPush.mockReset();
});

describe("requestMirrorPushAfterResponse", () => {
  it("inside a request, hands the push to after() and resolves at once", async () => {
    mocks.requestMirrorPush.mockResolvedValue(undefined);
    await requestMirrorPushAfterResponse();
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.requestMirrorPush).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0][0]();
    expect(mocks.requestMirrorPush).toHaveBeenCalledTimes(1);
  });

  it("outside a request, returns the push itself so a script can wait for it", async () => {
    mocks.after.mockImplementation(() => {
      throw new Error("after() was called outside a request scope");
    });
    let finished = false;
    mocks.requestMirrorPush.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      finished = true;
    });
    await requestMirrorPushAfterResponse();
    expect(finished).toBe(true);
  });

  it("never rejects, even if the push does", async () => {
    mocks.after.mockImplementation(() => {
      throw new Error("no request");
    });
    mocks.requestMirrorPush.mockRejectedValue(new Error("boom"));
    await expect(requestMirrorPushAfterResponse()).resolves.toBeUndefined();
  });
});
