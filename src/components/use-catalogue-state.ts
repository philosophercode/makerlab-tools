"use client";

import { useCallback, useMemo } from "react";
import type { GalleryTool } from "./catalog-types";
import { catalogueView, type CatalogueView } from "./catalogue-view";
import { parseGalleryState, toGallerySearchParams, type GalleryState } from "./gallery-filters";
import { useUrlSearch } from "./use-url-state";

export interface CatalogueState<T extends GalleryTool = GalleryTool> {
  /** What the URL asks for: the search, the facets, the view, the sort and the grouping. */
  state: GalleryState;
  /** Change some of it; written to the URL (`history.replaceState`), never pushed. */
  set: (patch: Partial<GalleryState>) => void;
  /** What the list shows for it (`catalogueView`). */
  view: CatalogueView<T>;
}

/**
 * The home page's one source of truth (amendment "One page: the list at
 * rest"): the query string, read on the client because the page is one
 * cached prerender (`useUrlSearch`). The search box above the list and the
 * list itself both read it, so the box's Enter opens the first result the
 * list shows.
 */
export function useCatalogueState<T extends GalleryTool>(tools: readonly T[], categoryOrder: readonly string[]): CatalogueState<T> {
  const [search, writeSearch] = useUrlSearch();
  const state = useMemo(() => parseGalleryState(new URLSearchParams(search)), [search]);
  // Read at call time, not from the render: two changes in one event both land.
  const set = useCallback(
    (patch: Partial<GalleryState>) =>
      writeSearch(toGallerySearchParams({ ...parseGalleryState(new URLSearchParams(window.location.search)), ...patch })),
    [writeSearch]
  );
  const view = useMemo(() => catalogueView(tools, state, categoryOrder), [tools, state, categoryOrder]);
  return { state, set, view };
}
