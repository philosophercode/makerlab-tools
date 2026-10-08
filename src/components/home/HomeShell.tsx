"use client";

import { useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { VisibilityState } from "@tanstack/react-table";
import type { GalleryTool } from "../catalog-types";
import { GalleryShell } from "../GalleryShell";
import { GALLERY_DEFAULT_HIDDEN, useGalleryColumns } from "../gallery-columns";
import { activeFilterCount } from "../catalogue-view";
import { categoryEntries } from "../palette/palette-search";
import { useCatalogueState } from "../use-catalogue-state";
import { FiltersPanel } from "./FiltersPanel";
import { HomeControls } from "./HomeControls";
import { HomeSearch } from "./HomeSearch";
import { LandingLockup } from "./LandingLockup";
import { useFiltersOpen } from "./use-filters-open";

/**
 * The home page (student home spec 2026-10-07, amendment "One page: the list
 * at rest", revised after the owner saw the first build). One page where
 * there were two (the categories at `/`, the full list at `/tools`):
 *
 * - **"MakerLAB AI"** at display size, then the one search box. The header's
 *   own lockup steps aside on this page, so the logo shows once.
 * - **A quiet row**: Categories | All tools, and a Filters button. Nothing
 *   else above the content; the filters, sort, grouping and grid/table live
 *   in the Filters panel, closed until asked for (`FiltersPanel`).
 * - **The content** (`GalleryShell`): the category tiles, a category's tools,
 *   or all tools grouped by category.
 * - **Typing**, in either view, swaps the content for the matching tools on
 *   the same page; the box's own list keeps the matching categories and "Ask
 *   MakerLAB AI" (`HomeSearch`). Emptying the box brings the view back.
 *
 * Everything but the panel's open state lives in the URL
 * (`useCatalogueState`), so a view, a search or a filter is a link, and the
 * page stays one cached prerender for everybody.
 */
export function HomeShell({ tools, categoryOrder }: { tools: readonly GalleryTool[]; categoryOrder: readonly string[] }) {
  const t = useTranslations("gallery.home");
  const { state, set, view } = useCatalogueState(tools, categoryOrder);
  const categories = useMemo(() => categoryEntries(tools), [tools]);
  // What the placeholder counts: the list unfiltered (a hidden-by-default category is not in it).
  const toolCount = useMemo(() => tools.filter((tool) => !tool.galleryHidden).length, [tools]);
  const first = view.searching ? view.shown[0] : undefined;

  const active = activeFilterCount(state);
  const [filtersOpen, toggleFilters] = useFiltersOpen();
  const panelId = useId();
  const columns = useGalleryColumns();
  const [visibility, setVisibility] = useState<VisibilityState>(GALLERY_DEFAULT_HIDDEN);

  return (
    <main className="ui mx-auto w-full max-w-[1440px] px-4 pb-16 sm:px-8" data-slot="home">
      <section
        aria-label={t("searchSection")}
        className="mx-auto flex w-full max-w-3xl flex-col items-center gap-5 pt-8 pb-8 sm:gap-7 sm:pt-12 sm:pb-10 lg:pt-14"
      >
        <LandingLockup />
        <div className="flex w-full flex-col gap-3">
          <HomeSearch
            value={state.query}
            onChange={(query) => set({ query })}
            categories={categories}
            firstResult={first ? { name: first.name, slug: first.slug } : null}
            onCategory={(category) => set({ category, query: "" })}
            toolCount={toolCount}
          />
          <HomeControls
            show={state.show}
            // Switching what to browse starts it afresh: no category carried over.
            onShow={(show) => set({ show, category: null })}
            filtersOpen={filtersOpen}
            onToggleFilters={toggleFilters}
            activeCount={active}
            panelId={panelId}
          />
          <FiltersPanel
            id={panelId}
            open={filtersOpen}
            tools={tools}
            state={state}
            set={set}
            view={view}
            categoryOrder={categoryOrder}
            columns={columns}
            visibility={visibility}
            onVisibility={setVisibility}
          />
        </div>
      </section>

      <GalleryShell state={state} set={set} view={view} columns={columns} visibility={visibility} />
    </main>
  );
}
