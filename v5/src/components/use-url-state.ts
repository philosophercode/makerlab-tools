"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * The page's query string as React state, for a cached page whose server
 * render cannot read it (UI system phase 5a — the gallery).
 *
 * The gallery is prerendered once for everybody under `cacheComponents`, so
 * the server cannot hand the island its `?sort=` the way `/admin/inventory`
 * does from `searchParams`. The URL is therefore the one source of truth on
 * the client: `useSyncExternalStore` renders the defaults on the server and
 * while hydrating (no mismatch), then the real query string — and every
 * change is written with `history.replaceState`, which never re-runs the
 * server component or pushes each keystroke onto the Back button.
 */

const EVENT = "makerlab:urlstate";

function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

const getSnapshot = () => window.location.search;
const getServerSnapshot = () => "";

export function useUrlSearch(): [string, (next: URLSearchParams) => void] {
  const search = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const write = useCallback((next: URLSearchParams) => {
    const query = next.toString();
    window.history.replaceState(window.history.state, "", query ? `?${query}` : window.location.pathname);
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [search, write];
}
