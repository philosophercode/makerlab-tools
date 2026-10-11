"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/**
 * When to show the sign-up notice (demo pass spec, amendment 2026-10-11): once
 * a visitor has been on the site for a minute, on whatever page they are on,
 * until they dismiss it, follow it, or sign up — then never again in this
 * browser.
 *
 * - The minute is counted from the first page of the visit: the start time
 *   lives in `sessionStorage`, so a full reload or a new page keeps counting
 *   rather than starting over, and the root layout's timer survives
 *   client-side navigation by itself.
 * - "Settled" lives in `localStorage` (`"dismissed"` or `"signed-up"`), and
 *   another tab hears it through the `storage` event.
 *
 * Both are per-viewer conveniences, nothing more. Every read and write is in
 * try/catch: private windows, blocked site data and thumbnail captures throw
 * or come back empty. Storage that throws counts as settled, so a browser
 * that cannot remember a dismissal is never shown the notice on every visit;
 * a write that fails is still honoured for the rest of the visit.
 */
export const SIGNUP_NUDGE_KEY = "makerlab.signup-nudge";
export const SIGNUP_NUDGE_SINCE_KEY = "makerlab.signup-nudge.since";
export const SIGNUP_NUDGE_DELAY_MS = 60_000;

export type SignupNudgeOutcome = "dismissed" | "signed-up";

const listeners = new Set<() => void>();
let settledThisVisit = false;

function storedSettled(): boolean {
  try {
    return window.localStorage.getItem(SIGNUP_NUDGE_KEY) !== null;
  } catch {
    return true;
  }
}

function snapshot(): boolean {
  return settledThisVisit || storedSettled();
}

function notify(): void {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent): void {
  if (event.key !== SIGNUP_NUDGE_KEY || event.newValue === null) return;
  settledThisVisit = true;
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

/** Never show the notice again in this browser: dismissed, followed, or signed up. */
export function settleSignupNudge(outcome: SignupNudgeOutcome): void {
  settledThisVisit = true;
  try {
    window.localStorage.setItem(SIGNUP_NUDGE_KEY, outcome);
  } catch {
    // Remembered for this visit only.
  }
  notify();
}

/** When this visit began: the stored start, or now (stored for the next page). */
function visitStart(now: number): number {
  try {
    const stored = Number(window.sessionStorage.getItem(SIGNUP_NUDGE_SINCE_KEY));
    if (Number.isFinite(stored) && stored > 0 && stored <= now) return stored;
    window.sessionStorage.setItem(SIGNUP_NUDGE_SINCE_KEY, String(now));
  } catch {
    // Counted from this page.
  }
  return now;
}

/** Tests only: forget the in-memory flag between cases (a new page load). */
export function resetSignupNudgeForTests(): void {
  settledThisVisit = false;
}

/**
 * Whether to draw the notice. The minute runs on every page; `eligible` only
 * decides whether it may be drawn on this one (not on the sign-up page, the
 * admin, the kiosk, or for a signed-in member). Nothing shows on the server
 * or during hydration — the notice is never in the HTML.
 */
export function useSignupNudge(eligible: boolean): { visible: boolean; dismiss: () => void } {
  const settled = useSyncExternalStore(subscribe, snapshot, () => true);
  const [due, setDue] = useState(false);

  useEffect(() => {
    if (settled || due) return;
    const now = Date.now();
    const wait = Math.max(0, SIGNUP_NUDGE_DELAY_MS - (now - visitStart(now)));
    const timer = window.setTimeout(() => setDue(true), wait);
    return () => window.clearTimeout(timer);
  }, [settled, due]);

  const dismiss = useCallback(() => settleSignupNudge("dismissed"), []);
  return { visible: eligible && due && !settled, dismiss };
}
