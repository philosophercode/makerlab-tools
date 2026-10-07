"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether this browser has dismissed the composer's "MakerLAB AI can make
 * mistakes" note (owner decision 2026-10-07: a small box above the composer,
 * closed with its ×). A per-viewer convenience in `localStorage`, like the
 * assistant's intro callout: every read and write is in try/catch, and a write
 * that fails still hides the note for the rest of the visit. The server and
 * the first client render show the note, so a reader who never dismissed it
 * never sees it arrive late.
 */
export const AI_NOTE_KEY = "makerlab.ai-note.dismissed";

const listeners = new Set<() => void>();
let dismissedThisVisit = false;

function storedDismissed(): boolean {
  try {
    return window.localStorage.getItem(AI_NOTE_KEY) !== null;
  } catch {
    return false;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === AI_NOTE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const snapshot = () => dismissedThisVisit || storedDismissed();
const serverSnapshot = () => false;

/** `[dismissed, dismiss]`: whether the note is closed in this browser, and closing it (every open chat hears it). */
export function useAiNoteDismissed(): [boolean, () => void] {
  const dismissed = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const dismiss = useCallback(() => {
    dismissedThisVisit = true;
    try {
      window.localStorage.setItem(AI_NOTE_KEY, "1");
    } catch {
      // Remembered for this visit only.
    }
    for (const listener of listeners) listener();
  }, []);
  return [dismissed, dismiss];
}

/** Tests only: forget a dismissal made earlier in the run. */
export function resetAiNoteForTests(): void {
  dismissedThisVisit = false;
  try {
    window.localStorage.removeItem(AI_NOTE_KEY);
  } catch {
    // Nothing stored.
  }
}
