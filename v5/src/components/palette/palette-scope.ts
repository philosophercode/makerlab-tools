"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { Role } from "../../lib/auth/roles";
import type { PaletteTool } from "./palette-types";

/**
 * What a page knows that the header's palette does not (public polish).
 *
 * The palette lives in the root layout and knows the published catalogue.
 * The admin layout has already resolved the viewer on the server and read the
 * **drafts** for a viewer who may see them; `PaletteScope` hands both over for
 * as long as an admin page is mounted, so ⌘K on an admin page offers drafts
 * and the viewer's admin pages at once, with no request. Only the drafts: the
 * published list is the root layout's, already on the page.
 */
export interface PaletteScopeValue {
  role: Role;
  /**
   * The drafts this viewer may open, added to the header's published list —
   * empty for a viewer who may not see drafts, and when they could not be read
   * (the published list is still right).
   */
  drafts: readonly PaletteTool[];
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
export function PaletteScope({ role, drafts }: PaletteScopeValue) {
  useEffect(() => {
    set({ role, drafts });
    return () => set(null);
  }, [role, drafts]);
  return null;
}
