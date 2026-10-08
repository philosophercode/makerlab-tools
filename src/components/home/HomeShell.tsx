"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { GalleryTool } from "../catalog-types";
import { GalleryShell } from "../GalleryShell";
import { categoryEntries } from "../palette/palette-search";
import { useCatalogueState } from "../use-catalogue-state";
import { HomeSearch } from "./HomeSearch";
import { LandingLockup } from "./LandingLockup";

/**
 * The home page: the whole tool list, the search above it (student home spec
 * 2026-10-07, amendment "One page: the list at rest"; the design review's
 * option "B — the list at rest"). One page where there were two (the
 * categories at `/`, the full list at `/tools`).
 *
 * - **"MakerLAB AI"** at display size, then the one search box. The header's
 *   own lockup steps aside on this page, so the logo shows once.
 * - **At rest**, every tool grouped by category in the lab's order, with the
 *   category chips and the list's filters, sort and views (`GalleryShell`).
 * - **Typing** swaps the groups for the matching tools, ranked, on the same
 *   page; the box's own list keeps the matching categories and "Ask MakerLAB
 *   AI" (`HomeSearch`). Emptying the box brings the groups back.
 *
 * Everything lives in the URL (`useCatalogueState`), so a search or a filter
 * is a link, and the page stays one cached prerender for everybody.
 */
export function HomeShell({ tools, categoryOrder }: { tools: readonly GalleryTool[]; categoryOrder: readonly string[] }) {
  const t = useTranslations("gallery.home");
  const { state, set, view } = useCatalogueState(tools, categoryOrder);
  const categories = useMemo(() => categoryEntries(tools), [tools]);
  // What the placeholder counts: the list unfiltered (a hidden-by-default category is not in it).
  const toolCount = useMemo(() => tools.filter((tool) => !tool.galleryHidden).length, [tools]);
  const first = view.searching ? view.shown[0] : undefined;

  return (
    <main className="ui mx-auto w-full max-w-[1440px] px-4 pb-16 sm:px-8" data-slot="home">
      <section
        aria-label={t("searchSection")}
        className="mx-auto flex w-full max-w-3xl flex-col items-center gap-5 pt-8 pb-6 sm:gap-7 sm:pt-12 sm:pb-8 lg:pt-14"
      >
        <LandingLockup />
        <HomeSearch
          value={state.query}
          onChange={(query) => set({ query })}
          categories={categories}
          firstResult={first ? { name: first.name, slug: first.slug } : null}
          onCategory={(category) => set({ category, query: "" })}
          toolCount={toolCount}
        />
      </section>

      <GalleryShell tools={tools} state={state} set={set} view={view} categoryOrder={categoryOrder} />
    </main>
  );
}
