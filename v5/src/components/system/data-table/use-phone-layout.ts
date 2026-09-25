"use client";

import { useSyncExternalStore } from "react";

/**
 * Is the viewport below Tailwind's `sm` (640px)? — `true`, `false`, or `null`
 * when nobody can know yet (the server render, hydration, or a runtime with no
 * `matchMedia`, such as jsdom).
 *
 * `DataTable` renders its phone list and its table *both* while this is `null`
 * and lets CSS pick (`sm:hidden` / `hidden sm:table`), so the first paint is
 * right at every width with no flash. Once the browser can answer, it renders
 * only the one that shows — so a row's interactive cells (a role select, a
 * ban button) exist once in the document, not twice with two states and two
 * sets of ids.
 */
const QUERY = "(max-width: 639.98px)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const list = window.matchMedia(QUERY);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

function snapshot(): boolean | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(QUERY).matches;
}

function serverSnapshot(): boolean | null {
  return null;
}

export function usePhoneLayout(): boolean | null {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
