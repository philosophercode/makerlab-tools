"use client";

import { useSyncExternalStore } from "react";

/**
 * False in the server's HTML and during hydration, true once React owns the
 * page — so a control that saves on change can be rendered **disabled until
 * it has a handler behind it**.
 *
 * Why it matters (found in UI phase 4 on `/admin/users`): a `<select>` changed
 * before its Suspense boundary hydrated had its choice reset to the rendered
 * value by hydration, and React then replayed the queued `change` event — with
 * the *reset* value. The action was asked to set the role the person already
 * held, answered `ok` (nothing to change), and the row said "Saved" over a
 * choice that never reached the server. Disabled until hydrated, there is no
 * choice to lose.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNothing, clientSnapshot, serverSnapshot);
}

function subscribeNothing(): () => void {
  return () => {};
}

function clientSnapshot(): boolean {
  return true;
}

function serverSnapshot(): boolean {
  return false;
}
