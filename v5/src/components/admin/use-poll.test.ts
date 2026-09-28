import { act, renderHook } from "@testing-library/react";
import { usePoll } from "./use-poll";

let hidden = false;
beforeEach(() => {
  hidden = false;
  vi.useFakeTimers();
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
});
afterEach(() => {
  vi.useRealTimers();
});

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function setHidden(value: boolean) {
  hidden = value;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

describe("usePoll (performance plan, quick win 13)", () => {
  it("ticks every interval while active", async () => {
    const tick = vi.fn();
    renderHook(() => usePoll(tick, 5000, true));
    await advance(15_000);
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it("does nothing while inactive", async () => {
    const tick = vi.fn();
    renderHook(() => usePoll(tick, 5000, false));
    await advance(15_000);
    expect(tick).not.toHaveBeenCalled();
  });

  it("skips ticks while the tab is hidden, then ticks once when it is shown", async () => {
    const tick = vi.fn();
    renderHook(() => usePoll(tick, 5000, true));
    setHidden(true);
    await advance(60_000);
    expect(tick).not.toHaveBeenCalled();

    setHidden(false);
    await advance(0);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it("does not tick on becoming visible when no tick was missed", async () => {
    const tick = vi.fn();
    renderHook(() => usePoll(tick, 5000, true));
    setHidden(true);
    setHidden(false);
    await advance(0);
    expect(tick).not.toHaveBeenCalled();
  });

  it("never overlaps a slow async tick", async () => {
    let finish: () => void = () => {};
    const tick = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    renderHook(() => usePoll(tick, 1000, true));
    await advance(5000);
    expect(tick).toHaveBeenCalledTimes(1);
    finish();
    await advance(1000);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it("stops on unmount", async () => {
    const tick = vi.fn();
    const { unmount } = renderHook(() => usePoll(tick, 5000, true));
    unmount();
    await advance(20_000);
    expect(tick).not.toHaveBeenCalled();
  });
});
