import { act, renderHook } from "@testing-library/react";
import { REFRESH_NUDGE_DURATION_MS, REFRESH_NUDGE_INTERVAL_MS, useRefreshNudge } from "./use-refresh-nudge";

/**
 * `useRefreshNudge` re-renders its island for a few seconds after an action,
 * so a refreshed page that finished rendering is committed (see the module's
 * docstring). What matters: it renders while nudging, it stops on its own, and
 * it stops on unmount — an island the new page no longer contains must not
 * keep a timer alive.
 */

let renders = 0;

function mount() {
  renders = 0;
  return renderHook(() => {
    renders += 1;
    return useRefreshNudge();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it("does nothing until nudged", () => {
  mount();
  act(() => vi.advanceTimersByTime(REFRESH_NUDGE_DURATION_MS));
  expect(renders).toBe(1);
});

it("re-renders on every interval while nudging, then stops by itself", () => {
  const { result } = mount();

  act(() => result.current());
  // One act per tick: inside a single act React would batch the three bumps.
  for (let tick = 0; tick < 3; tick++) act(() => vi.advanceTimersByTime(REFRESH_NUDGE_INTERVAL_MS));
  expect(renders).toBe(4);

  act(() => vi.advanceTimersByTime(REFRESH_NUDGE_DURATION_MS * 2));
  const settled = renders;
  expect(settled).toBeLessThanOrEqual(2 + REFRESH_NUDGE_DURATION_MS / REFRESH_NUDGE_INTERVAL_MS);
  expect(vi.getTimerCount()).toBe(0);

  act(() => vi.advanceTimersByTime(REFRESH_NUDGE_DURATION_MS));
  expect(renders).toBe(settled);
});

it("stops when the island unmounts", () => {
  const { result, unmount } = mount();
  act(() => result.current());
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
