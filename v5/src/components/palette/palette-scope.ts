"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { Role } from "../../lib/auth/roles";
import type { PaletteTool } from "./palette-types";

/**
 * What a page knows that the header's palette does not (public polish).
 *
 * The palette lives in the root layout and knows the published catalogue.
 * The admin layout has already resolved the viewer on the server and read the
 * tool index **with drafts** for a viewer who may see them; `PaletteScope`
 * hands both over for as long as an admin page is mounted, so ⌘K on an admin
 * page offers drafts and the viewer's admin pages at once, with no request.
 */
export interface PaletteScopeValue {
  role: Role;
  /** Null when the admin layout could not read the list. */
  tools: readonly PaletteTool[] | null;
}

let current: PaletteScopeValue | null = null;
const listeners = new Set<() => void>();

function set(value: PaletteScopeValue | null): void {
  current = value;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePaletteScope(): PaletteScopeValue | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null
  );
}

/** Rendered by a layout that knows more than the header: publishes while mounted. Renders nothing. */
export function PaletteScope({ role, tools }: PaletteScopeValue) {
  useEffect(() => {
    set({ role, tools });
    return () => set(null);
  }, [role, tools]);
  return null;
}
