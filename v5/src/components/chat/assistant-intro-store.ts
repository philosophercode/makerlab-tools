"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether this browser has met the MakerLAB Assistant (identity spec
 * 2026-09-28 §3): the first-visit callout next to the chat button shows until
 * it is dismissed or the chat is opened, then never again.
 *
 * The flag lives in `localStorage` — a per-viewer convenience, nothing more.
 * Every read and write is in try/catch: private windows, blocked site data and
 * thumbnail captures throw or come back empty. A write that fails still hides
 * the callout for the rest of the visit (the in-memory flag), so a dismissed
 * callout never comes back on the next render.
 */
export const ASSISTANT_INTRO_KEY = "makerlab.assistant-intro.seen";

const listeners = new Set<() => void>();
let dismissedThisVisit = false;

function read(): boolean {
  if (dismissedThisVisit) return true;
  try {
    return window.localStorage.getItem(ASSISTANT_INTRO_KEY) === "1";
  } catch {
    // Storage unavailable: treat as seen, so a browser that cannot remember
    // the dismissal is never shown the callout on every page.
    return true;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Record that the viewer has met the assistant, and hide the callout everywhere. */
export function markAssistantIntroSeen(): void {
  if (dismissedThisVisit) return;
  dismissedThisVisit = true;
  try {
    window.localStorage.setItem(ASSISTANT_INTRO_KEY, "1");
  } catch {
    // Remembered for this visit only.
  }
  for (const listener of listeners) listener();
}

/** Tests only: forget the in-memory flag between cases. */
export function resetAssistantIntroForTests(): void {
  dismissedThisVisit = false;
}

/**
 * `seen` is true on the server and during hydration (the callout is never in
 * the HTML), then whatever this browser remembers.
 */
export function useAssistantIntroSeen(): { seen: boolean; markSeen: () => void } {
  const seen = useSyncExternalStore(subscribe, read, () => true);
  const markSeen = useCallback(() => markAssistantIntroSeen(), []);
  return { seen, markSeen };
}
