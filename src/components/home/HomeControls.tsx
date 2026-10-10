"use client";

import { useTranslations } from "next-intl";
import { SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GalleryShow } from "../gallery-filters";

/**
 * The quiet row under the home page's search (student home spec, amendment
 * "One page: the list at rest", revised): what to browse — **Categories**
 * (the tiles, the default) or **All tools** — and a **Filters** button that
 * opens the Filters panel, with the number of filters set. Nothing else sits
 * between the search and the content.
 *
 * The switch is a group of two toggle buttons (`aria-pressed`), drawn like
 * the header's links: the chosen one in ink with the accent rule under it.
 * Filters is a disclosure button (`aria-expanded`, `aria-controls`).
 *
 * The row wraps rather than running off a phone: "Todas las herramientas" in
 * mono capitals is ~180px, and at 320–390px Filters used to push the page
 * sideways in Spanish, Portuguese, French and Russian (DESIGN.md §6). Filters
 * keeps to the row's end (`ms-auto`), on a line of its own when it must.
 */
export function HomeControls({
  show,
  onShow,
  filtersOpen,
  onToggleFilters,
  activeCount,
  panelId,
}: {
  show: GalleryShow;
  onShow: (show: GalleryShow) => void;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  activeCount: number;
  /** The Filters panel's id. */
  panelId: string;
}) {
  const t = useTranslations("gallery");
  const tFilters = useTranslations("ui.filters");
  const options: Array<{ value: GalleryShow; label: string }> = [
    { value: "categories", label: t("search.categories") },
    { value: "all", label: t("browse.all") },
  ];
  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-2" data-slot="home-controls">
      <div role="group" aria-label={t("browse.label")} className="flex flex-wrap items-center gap-x-4 gap-y-1 sm:gap-x-5">
        {options.map((option) => {
          const chosen = option.value === show;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={chosen}
              onClick={() => onShow(option.value)}
              className={cn(
                "-mb-px h-8 cursor-pointer border-b-2 font-mono text-label tracking-[0.08em] whitespace-nowrap uppercase transition-colors duration-150",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
                chosen ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        aria-expanded={filtersOpen}
        aria-controls={panelId}
        aria-label={tFilters("filtersButton", { count: activeCount })}
        onClick={onToggleFilters}
        data-slot="filters-button"
        className={cn(
          "ms-auto inline-flex h-8 cursor-pointer items-center gap-2 border px-3 font-mono text-label tracking-[0.08em] whitespace-nowrap uppercase transition-colors duration-150",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
          filtersOpen ? "border-foreground/50 text-foreground" : "border-input text-muted-foreground hover:border-foreground/40 hover:text-foreground"
        )}
      >
        <SlidersHorizontal aria-hidden="true" className="size-3.5" />
        {tFilters("filters")}
        {activeCount > 0 ? (
          <span aria-hidden="true" className="inline-flex min-w-4 items-center justify-center bg-foreground px-1 text-background tabular-nums">
            {activeCount}
          </span>
        ) : null}
      </button>
    </div>
  );
}
