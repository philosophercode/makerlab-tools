"use client";

import { useState, useSyncExternalStore } from "react";
import { activeFilterCount } from "../catalogue-view";
import { parseGalleryState } from "../gallery-filters";

/**
 * Whether the home page's Filters panel is open (student home spec,
 * amendment "One page: the list at rest", revised). Closed until somebody
 * presses Filters — or open when the page is reached by a link with a filter
 * set, so a filtered link shows what filters it. Opening a category's tile
 * is not a filter and leaves the panel as it was. The choice is remembered
 * for this visit only: kept in the module, it survives going to a tool page
 * and back, and a reload starts afresh. Nothing is stored in the browser.
 */
let remembered: boolean | null = null;

const noSubscription = () => () => {};

export function useFiltersOpen(): [open: boolean, toggle: () => void] {
  const [toggled, setToggled] = useState<boolean | null>(remembered);
  // The URL this page was reached with, read once per visit to it. The cached
  // page cannot read it on the server, so hydration renders closed and the
  // first client render opens it.
  const [arrival] = useState(() => {
    let filtered: boolean | null = null;
    return () => (filtered ??= activeFilterCount(parseGalleryState(new URLSearchParams(window.location.search))) > 0);
  });
  const arrivedFiltered = useSyncExternalStore(noSubscription, arrival, () => false);
  const open = toggled ?? arrivedFiltered;
  const toggle = () => {
    remembered = !open;
    setToggled(!open);
  };
  return [open, toggle];
}

/** Forget the visit's choice (tests). */
export function forgetFiltersOpen(): void {
  remembered = null;
}
