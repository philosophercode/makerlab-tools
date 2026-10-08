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
  // A router navigation to this same page with another query — a link to `/`
  // followed on `/?q=laser` — changes the address but re-renders nothing on a
  // cached page. The Navigation API reports every change of entry, where the
  // browser has it. Next writes the entry from an insertion effect, where
  // React refuses updates, so the re-read waits for the commit to finish.
  const navigation = (window as Window & { navigation?: EventTarget }).navigation;
  const later = () => queueMicrotask(onChange);
  navigation?.addEventListener("currententrychange", later);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(EVENT, onChange);
    navigation?.removeEventListener("currententrychange", later);
  };
}

const getSnapshot = () => window.location.search;
const getServerSnapshot = () => "";

/**
 * Open `href`, a page that reads its query string on the client (the tool
 * list on the home page). From that same page — the ⌘K palette's category
 * row on `/` — a router push would change the address and nothing on the
 * page, since the cached prerender never re-renders for a new query; so this
 * pushes a history entry (Next keeps its router in step with
 * `history.pushState`) and tells `useUrlSearch` to read it. From any other
 * page it is the router's push.
 */
export function openClientQueryPage(href: string, push: (href: string) => void): void {
  const target = new URL(href, window.location.href);
  if (target.origin !== window.location.origin || target.pathname !== window.location.pathname) {
    push(href);
    return;
  }
  window.history.pushState(null, "", `${target.pathname}${target.search}${target.hash}`);
  window.dispatchEvent(new Event(EVENT));
}

export function useUrlSearch(): [string, (next: URLSearchParams) => void] {
  const search = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const write = useCallback((next: URLSearchParams) => {
    const query = next.toString();
    window.history.replaceState(window.history.state, "", query ? `?${query}` : window.location.pathname);
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [search, write];
}
