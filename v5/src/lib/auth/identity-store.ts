"use client";

import { useSyncExternalStore } from "react";
import type { ClientIdentity } from "./sign-in-client";

/**
 * The header's answer to "who is this", shared (public polish).
 *
 * `PrimaryNav` asks `/api/identity` once after mount (auth spec §6) and
 * publishes the answer here, so the ⌘K palette beside it can offer the admin
 * pages a role opens without a second request. `null` until it has answered —
 * the palette treats that as anonymous, which offers nothing it should not.
 */
let current: ClientIdentity | null = null;
const listeners = new Set<() => void>();

export function publishIdentity(identity: ClientIdentity | null): void {
  current = identity;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSharedIdentity(): ClientIdentity | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null
  );
}
