"use client";

import { useSyncExternalStore } from "react";
import { fetchIdentity, type ClientIdentity } from "./sign-in-client";

/**
 * The page's answer to "who is this", shared (public polish; performance plan,
 * quick win 10).
 *
 * `/api/identity` is asked **once per page load**, whoever asks first — the
 * header (`PrimaryNav`), the tool page's Edit control, the project form — and
 * everybody else joins that request or reads its answer. Each used to send
 * its own: a tool page made two identical requests, and its Edit control
 * appeared a round trip after the header.
 *
 * - `null` from the store means "no evidence of a signed-in person": still
 *   asking, or the request failed. Callers that must tell those apart (the
 *   project form's "Try again") use the promise {@link loadSharedIdentity}
 *   returns.
 * - A failed answer is not kept: the next {@link loadSharedIdentity} asks
 *   again. A good answer lasts until the page reloads — sign-in and sign-out
 *   both reload it.
 */
interface SharedIdentityState {
  current: ClientIdentity | null;
  request: Promise<ClientIdentity | null> | null;
  listeners: Set<() => void>;
}

/**
 * Kept on `globalThis` under this key so the test setup can forget it between
 * tests (`vitest.setup.ts`) without importing this module — importing it there
 * would bind the real `fetchIdentity` before a test file mocks it.
 */
export const SHARED_IDENTITY_KEY = "__makerlab_shared_identity__";

function state(): SharedIdentityState {
  const holder = globalThis as unknown as Record<string, SharedIdentityState | undefined>;
  return (holder[SHARED_IDENTITY_KEY] ??= { current: null, request: null, listeners: new Set() });
}

export function publishIdentity(identity: ClientIdentity | null): void {
  const shared = state();
  shared.current = identity;
  for (const listener of shared.listeners) listener();
}

/** The shared answer: the one in hand, the request in flight, or a new request. */
export function loadSharedIdentity(): Promise<ClientIdentity | null> {
  const shared = state();
  if (shared.current) return Promise.resolve(shared.current);
  if (!shared.request) {
    shared.request = fetchIdentity()
      .then((identity) => {
        publishIdentity(identity);
        return identity;
      })
      .finally(() => {
        shared.request = null;
      });
  }
  return shared.request;
}

function subscribe(listener: () => void): () => void {
  const { listeners } = state();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSharedIdentity(): ClientIdentity | null {
  return useSyncExternalStore(
    subscribe,
    () => state().current,
    () => null
  );
}
