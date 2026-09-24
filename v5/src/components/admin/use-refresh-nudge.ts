"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";

/** How often a nudge re-renders the island while a refreshed page may be waiting. */
export const REFRESH_NUDGE_INTERVAL_MS = 200;
/** How long the nudging lasts — far longer than the refreshed tree takes to arrive. */
export const REFRESH_NUDGE_DURATION_MS = 4_000;

/**
 * Make sure the page a server action refreshed is actually shown.
 *
 * **What goes wrong without it.** The mirror's actions end in
 * `revalidatePath("/admin/mirror")`, so the action's response carries the
 * re-rendered page and Next applies it in a transition. In this app's
 * production build (Next 16.1, React 19.2, `cacheComponents`) that transition
 * finished rendering and then **was not committed until something else updated
 * the page** — a keystroke, a click, a timer. Found by E2E scenario 8: after
 * Connect the form stayed on screen indefinitely, yet typing one character
 * swapped in the connected page within 25 ms; an in-place refresh (Pause →
 * Resume) sat 11–14 s until `MirrorControls`' 15-second clock ticked. Nothing
 * was pending on the network, `requestAnimationFrame` fired, fonts were
 * loaded. A later `router.refresh()` queued behind the stalled one, so calling
 * it does not help.
 *
 * **What this does.** The island calls `nudge()` once its action has
 * answered. For the next few seconds it re-renders itself every
 * {@link REFRESH_NUDGE_INTERVAL_MS}; each render is an ordinary update, which
 * makes React pick up the finished transition and commit it. The island is
 * small, the renders change nothing it shows, and the interval stops on
 * unmount — which is exactly what happens when the committed page no longer
 * contains it (Connect, Disconnect).
 *
 * If a future Next or React release commits the transition on its own, this
 * becomes a harmless handful of no-op renders; delete it then, and E2E
 * scenario 8 will say whether that was right.
 */
export function useRefreshNudge(): () => void {
  const [, bump] = useReducer((count: number) => count + 1, 0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timer.current !== null) clearInterval(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  return useCallback(() => {
    stop();
    const until = Date.now() + REFRESH_NUDGE_DURATION_MS;
    timer.current = setInterval(() => {
      bump();
      if (Date.now() >= until) stop();
    }, REFRESH_NUDGE_INTERVAL_MS);
  }, [stop]);
}
