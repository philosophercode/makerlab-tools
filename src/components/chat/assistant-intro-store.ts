"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

/**
 * Whether this browser has met MakerLAB AI (identity spec
 * 2026-09-28 §3): the callout next to the chat button shows on the first page
 * it can, stays on that page until it is dismissed or the page is left, and
 * never comes back — not on the next page, not on the next visit. Dismissing
 * it or opening the chat hides it at once, in every open tab.
 *
 * The flag lives in `localStorage` — a per-viewer convenience, nothing more:
 * `"1"` once the callout has been shown, `"dismissed"` once it was dismissed
 * or the chat opened (the change is what other tabs hear through the
 * `storage` event). Every read and write is in try/catch: private windows,
 * blocked site data and thumbnail captures throw or come back empty. Storage
 * that throws counts as seen, so a browser that cannot remember is never shown
 * the callout on every page; a write that fails is still honoured for the rest
 * of the visit through the in-memory flags.
 */
export const ASSISTANT_INTRO_KEY = "makerlab.assistant-intro.seen";

const SHOWN = "1";
const DISMISSED = "dismissed";

const listeners = new Set<() => void>();
let dismissedThisVisit = false;
/** The path the callout was first shown on during this visit, if it was. */
let shownOn: string | null = null;

function storedSeen(): boolean {
  try {
    return window.localStorage.getItem(ASSISTANT_INTRO_KEY) !== null;
  } catch {
    return true;
  }
}

function write(value: string): void {
  try {
    window.localStorage.setItem(ASSISTANT_INTRO_KEY, value);
  } catch {
    // Remembered for this visit only.
  }
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** `"seen"`, `"new"` (never shown in this browser) or `"shown:<path>"` (shown this visit, on that path). */
function snapshot(): string {
  if (dismissedThisVisit) return "seen";
  if (shownOn !== null) return `shown:${shownOn}`;
  return storedSeen() ? "seen" : "new";
}

function onStorage(event: StorageEvent): void {
  if (event.key !== ASSISTANT_INTRO_KEY || event.newValue !== DISMISSED) return;
  dismissedThisVisit = true;
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

/** Record that the callout was shown on `path`: it stays there, and nowhere else. */
function markShown(path: string): void {
  if (dismissedThisVisit || shownOn !== null) return;
  shownOn = path;
  write(SHOWN);
  notify();
}

/** Record that the viewer has met the assistant, and hide the callout everywhere. */
export function markAssistantIntroSeen(): void {
  if (dismissedThisVisit) return;
  dismissedThisVisit = true;
  write(DISMISSED);
  notify();
}

/** Tests only: forget the in-memory flags between cases (a new page load). */
export function resetAssistantIntroForTests(): void {
  dismissedThisVisit = false;
  shownOn = null;
}

/**
 * Whether to draw the callout on `path`. `eligible` is false where it never
 * shows (the kiosk, the admin, while the chat is open); an ineligible page
 * does not use up the one showing. Nothing shows on the server or during
 * hydration — the callout is never in the HTML.
 */
export function useAssistantIntro(path: string, eligible: boolean): { visible: boolean; markSeen: () => void } {
  const state = useSyncExternalStore(subscribe, snapshot, () => "seen");
  useEffect(() => {
    if (eligible && state === "new") markShown(path);
  }, [eligible, state, path]);
  const markSeen = useCallback(() => markAssistantIntroSeen(), []);
  const visible = eligible && (state === "new" || state === `shown:${path}`);
  return { visible, markSeen };
}
