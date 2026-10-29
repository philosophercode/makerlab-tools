"use client";

import { useSyncExternalStore } from "react";

/**
 * Tailwind's `sm` breakpoint, where the chat sheet stops covering the whole
 * screen and becomes a 440px panel beside the page (`ChatPanel`). Must match
 * the `sm:w-[440px]` there.
 */
const DOCKED = "(min-width: 40rem)";

function subscribeDocked(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(DOCKED);
  query.addEventListener?.("change", onChange);
  return () => query.removeEventListener?.("change", onChange);
}

function isDocked(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(DOCKED).matches;
}

/**
 * True when the chat is a panel beside the page rather than a full-screen
 * sheet. Docked, the page stays live: it scrolls, its rows can be ticked for
 * the assistant, its links work. False on the server and while hydrating —
 * the chat never renders there, it mounts on first open.
 */
export function useDockedChat(): boolean {
  return useSyncExternalStore(subscribeDocked, isDocked, () => false);
}
