"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/** How long each line shows, fade included (student home spec 2026-10-07 §6). */
export const ROTATE_EVERY_MS = 3000;
/** The fade out, then the same fade in. Matches `duration-300` on the line. */
export const FADE_MS = 300;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener?.("change", onChange);
  return () => query.removeEventListener?.("change", onChange);
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION).matches;
}

/** True when the visitor asked for less motion. False on the server and while hydrating. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
}

export interface RotatingLine {
  /** Which line shows. */
  index: number;
  /** False during the fade out, while the next line waits to come in. */
  visible: boolean;
}

/**
 * The smart search's placeholder line: one of `count` lines, the next fading
 * in about every three seconds. It holds still while `paused` (the field has
 * focus or text) and under reduced motion, where it is the first line and
 * never changes. The server and the first client render show line 0, so the
 * HTML never disagrees with hydration.
 */
export function useRotatingLine(count: number, { paused }: { paused: boolean }): RotatingLine {
  const reduced = useReducedMotion();
  const [line, setLine] = useState<RotatingLine>({ index: 0, visible: true });
  const still = paused || reduced || count < 2;

  useEffect(() => {
    if (still) return;
    let fade: ReturnType<typeof setTimeout> | undefined;
    const timer = setInterval(() => {
      setLine((current) => ({ ...current, visible: false }));
      fade = setTimeout(() => setLine((current) => ({ index: (current.index + 1) % count, visible: true })), FADE_MS);
    }, ROTATE_EVERY_MS);
    return () => {
      clearInterval(timer);
      if (fade) clearTimeout(fade);
      // Paused mid-fade: show the line that was fading out rather than nothing.
      setLine((current) => (current.visible ? current : { ...current, visible: true }));
    };
  }, [still, count]);

  if (reduced) return { index: 0, visible: true };
  return { index: line.index % Math.max(count, 1), visible: line.visible };
}
