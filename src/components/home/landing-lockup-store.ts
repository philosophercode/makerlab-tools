"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the home page's big "MakerLAB AI" lockup is on screen (student home
 * spec, amendment "One page: the list at rest"). The header hides its own
 * lockup while the page's shows, so the logo appears once, and brings it back
 * once the page's has scrolled away under the bar.
 *
 * True until the landing lockup says otherwise: the server render, the
 * loading skeleton and the first paint of `/` all have it in view.
 */
let onScreen = true;
const listeners = new Set<() => void>();

export function setLandingLockupOnScreen(next: boolean): void {
  if (next === onScreen) return;
  onScreen = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLandingLockupOnScreen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => onScreen,
    () => true
  );
}
