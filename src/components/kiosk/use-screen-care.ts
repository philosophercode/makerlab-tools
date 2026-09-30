"use client";

import { useEffect, useRef, useState } from "react";
import { msUntilLabHour, RELOAD_HOUR } from "@/lib/kiosk/derive";

/**
 * The things a screen that runs for days needs and a web page usually does
 * not (kiosk spec §5.1, §5.2):
 *
 * - {@link useNow} — one clock for the clock face, staleness, rotation and the
 *   burn-in shift, started from the server's time so hydration matches.
 * - {@link useOnline} — `navigator.onLine`, for the "Offline" bar.
 * - {@link useWakeLock} — a Screen Wake Lock where the browser has one,
 *   re-asked whenever the page is shown again (the browser drops it on hide).
 *   Guided Access with Auto-Lock off is still the iPad's real answer.
 * - {@link useNightlyReload} — reload once a day at 04:00 lab time so a deploy
 *   reaches the screen, **skipped while the last poll failed**: reloading an
 *   offline page would blank the screen.
 * - {@link useForcedDarkTheme} — the kiosk is dark whatever the device stored.
 *   `ThemeScript` sets it before the first paint; this keeps it through a
 *   client navigation and puts the previous theme back on the way out.
 */

export function useNow(initial: number, everyMs = 1_000): number {
  const [now, setNow] = useState(initial);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

export function useWakeLock(): void {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const request = async () => {
      if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
      try {
        const next = await navigator.wakeLock.request("screen");
        if (cancelled) void next.release().catch(() => undefined);
        else lock = next;
      } catch {
        // Refused (battery saver, no user gesture yet, an old browser): the
        // device's own settings are the fallback, and the setup notes say so.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void request();
    };
    void request();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, []);
}

export function useNightlyReload(timeZone: string, failures: number): void {
  const failuresRef = useRef(failures);
  useEffect(() => {
    failuresRef.current = failures;
  }, [failures]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      timer = setTimeout(() => {
        if (failuresRef.current === 0) window.location.reload();
        else arm();
      }, msUntilLabHour(Date.now(), RELOAD_HOUR, timeZone));
    };
    arm();
    return () => clearTimeout(timer);
  }, [timeZone]);
}

export function useForcedDarkTheme(): void {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute("data-theme");
    root.setAttribute("data-theme", "dark");
    return () => {
      if (previous === null || previous === "dark") {
        // Put back what the visitor had stored, the way ThemeScript would.
        let stored: string | null = null;
        try {
          stored = localStorage.getItem("theme");
        } catch {
          stored = null;
        }
        if (stored === "light" || stored === "dark") root.setAttribute("data-theme", stored);
        else root.removeAttribute("data-theme");
      } else {
        root.setAttribute("data-theme", previous);
      }
    };
  }, []);
}
