"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * The rows a list page has ticked, for the assistant (assistant–GUI parity
 * spec §3.6). List islands publish their selection with
 * {@link usePublishSelection}; `ChatFab` reads the latest with
 * {@link usePageSelectionReader} **when a message is sent**, never
 * continuously, and sends ids only — the server re-reads every row and drops
 * any the person may not act on (`lib/actions/page-context.ts`).
 *
 * Kept in a ref, not state: publishing a selection must not re-render the
 * chat, and the chat only needs it at send time. Without a provider (a
 * component test) publishing is a no-op.
 */

/** Must match `SELECTION_KINDS` in `lib/actions/page-context.ts` — the server drops any other. */
export type PageSelectionKind = "maintenance_log" | "feedback" | "project" | "tool" | "pending_tool";

export interface PageSelection {
  kind: PageSelectionKind;
  ids: string[];
}

/** A box that outlives renders: writing it re-renders nobody. */
interface Store {
  read: () => PageSelection | null;
  write: (selection: PageSelection | null, owner: symbol) => void;
  /** Clear it, but only if `owner` wrote what is there now. */
  release: (owner: symbol) => void;
}

function createStore(): Store {
  let current: PageSelection | null = null;
  let writer: symbol | null = null;
  return {
    read: () => current,
    write: (selection, owner) => {
      current = selection;
      writer = owner;
    },
    release: (owner) => {
      if (writer !== owner) return;
      current = null;
      writer = null;
    },
  };
}

const PageSelectionContext = createContext<Store | null>(null);

export function PageSelectionProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createStore);
  return <PageSelectionContext.Provider value={store}>{children}</PageSelectionContext.Provider>;
}

/**
 * Publish `ids` as the page's selection while the calling island is mounted.
 * An empty list publishes nothing; unmounting (navigating away) clears it, so
 * a selection never outlives the page it was made on.
 */
export function usePublishSelection(kind: PageSelectionKind, ids: readonly string[]): void {
  const store = useContext(PageSelectionContext);
  const [owner] = useState(() => Symbol("page-selection"));
  const key = ids.join(",");
  useEffect(() => {
    if (!store) return;
    // Nothing ticked clears only what this island published, so a list with
    // no selection never wipes another's.
    if (key) store.write({ kind, ids: key.split(",") }, owner);
    else store.release(owner);
    return () => store.release(owner);
  }, [store, kind, key, owner]);
}

const readNothing = (): PageSelection | null => null;

/** A function returning the selection as it is now — for the chat's transport, at send time. */
export function usePageSelectionReader(): () => PageSelection | null {
  const store = useContext(PageSelectionContext);
  return store ? store.read : readNothing;
}
