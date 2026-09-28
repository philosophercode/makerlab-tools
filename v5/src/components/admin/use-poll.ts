"use client";

import { useEffect, useRef } from "react";

/**
 * Run `tick` every `intervalMs` while `active` — but not while the tab is
 * hidden (performance plan, quick win 13).
 *
 * Every admin poller (the intake and refresh queues, a refresh's review, a
 * preliminary page's image search, the mirror, an import being read) re-renders
 * its whole route every few seconds while work is in flight — 220–250 KB and a
 * dozen queries a tick. A tab left open in the background kept doing that for
 * nobody. Now a hidden tab skips its ticks, and the moment it is shown again
 * it ticks once, so what the person sees is current.
 *
 * - The latest `tick` is always the one called; changing it does not restart
 *   the interval.
 * - A tick that returns a promise is not overlapped by the next one.
 * - Nothing runs after unmount or once `active` turns false.
 */
export function usePoll(tick: () => void | Promise<void>, intervalMs: number, active: boolean): void {
  const latest = useRef(tick);
  useEffect(() => {
    latest.current = tick;
  }, [tick]);

  useEffect(() => {
    if (!active) return;
    let running = false;
    let missed = false;

    const run = () => {
      if (running) return;
      let result: void | Promise<void>;
      try {
        result = latest.current();
      } catch {
        return; // A dropped tick is retried on the next one.
      }
      // Only an async tick holds the next one back, until it settles.
      if (result && typeof (result as Promise<void>).then === "function") {
        running = true;
        (result as Promise<void>)
          .catch(() => {})
          .finally(() => {
            running = false;
          });
      }
    };

    const timer = setInterval(() => {
      if (document.hidden) {
        missed = true;
        return;
      }
      run();
    }, intervalMs);

    const onVisibility = () => {
      if (document.hidden || !missed) return;
      missed = false;
      run();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, intervalMs]);
}
