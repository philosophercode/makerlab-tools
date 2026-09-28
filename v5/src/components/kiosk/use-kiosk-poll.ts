"use client";

import { useEffect, useRef, useState } from "react";
import { nextPollDelay } from "@/lib/kiosk/derive";
import type { KioskSnapshot } from "@/lib/kiosk/types";

export const KIOSK_ENDPOINT = "/api/kiosk";

export interface KioskPollState {
  /** The last good snapshot, or null when there has never been one. */
  snapshot: KioskSnapshot | null;
  /** When this screen last got a good answer (its own clock). */
  lastOkAt: number;
  /** Failures in a row since then. */
  failures: number;
}

/**
 * The refresh loop (kiosk spec §5.2). `GET /api/kiosk` every minute plus up to
 * 10 s of jitter; on a failure or a non-200 the last good snapshot stays and
 * the wait backs off — one minute, two, then five. Coming back online polls at
 * once. The screen never goes blank and never shows a snapshot it did not get.
 *
 * `initialOkAt` is the server's time for the first render, so the server and
 * the browser draw the same "Updated" line; it is replaced by the screen's own
 * clock on mount, because staleness is measured on the clock that is ticking.
 */
export function useKioskPoll(initial: KioskSnapshot | null, initialOkAt: number): KioskPollState {
  const [state, setState] = useState<KioskPollState>({ snapshot: initial, lastOkAt: initialOkAt, failures: 0 });
  const failuresRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // The first render's data arrived with the page: that was a good answer.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- adopting the device clock once, on mount (see above).
    if (initial) setState((s) => ({ ...s, lastOkAt: Date.now() }));

    const schedule = () => {
      clearTimeout(timer);
      if (!cancelled) timer = setTimeout(poll, nextPollDelay(failuresRef.current));
    };

    async function poll() {
      if (inFlight) return;
      inFlight = true;
      try {
        const res = await fetch(KIOSK_ENDPOINT, { cache: "no-store", headers: { accept: "application/json" } });
        if (!res.ok) throw new Error(`kiosk poll: ${res.status}`);
        const body = (await res.json()) as unknown;
        if (!isSnapshot(body)) throw new Error("kiosk poll: unexpected body");
        failuresRef.current = 0;
        if (!cancelled) setState({ snapshot: body, lastOkAt: Date.now(), failures: 0 });
      } catch {
        failuresRef.current += 1;
        if (!cancelled) setState((s) => ({ ...s, failures: failuresRef.current }));
      } finally {
        inFlight = false;
        schedule();
      }
    }

    const onOnline = () => void poll();
    window.addEventListener("online", onOnline);
    schedule();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener("online", onOnline);
    };
    // Mount once: the loop owns its own schedule.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}

/** Enough of the shape to draw: a 200 that is not a snapshot is a failure, not a blank screen. */
function isSnapshot(value: unknown): value is KioskSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<KioskSnapshot>;
  return typeof v.generatedAt === "string" && Array.isArray(v.down) && Array.isArray(v.featured) && typeof v.lab === "object";
}
