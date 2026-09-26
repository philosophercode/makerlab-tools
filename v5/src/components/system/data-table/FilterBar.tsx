"use client";

import { useId, useState, type ReactNode } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

/**
 * The toolbar every list shares — the gallery, the inventory, people, import
 * review and the queues (UI system spec §7.2; DESIGN.md §8.4; public polish).
 * One structure, so the pages read alike:
 *
 * - **Row 1**: the search across the page, the count as quiet text at its end.
 * - **Row 2**: the facets and Clear on the left; `secondary` (Group by,
 *   Columns) and `end` (Sort, the view switch) on the right. At 1024–1440px
 *   nothing wraps.
 * - **Phone** (below `sm`): the search, then one row — a **Filters** button
 *   (with the number of facets set) that opens a `Sheet` holding the facets,
 *   `secondary` and Clear — and `end`; the count on a small line under it.
 *
 * It owns no filter state. The caller holds it — the inventory and the gallery
 * write it to the URL — and filters the rows it hands the `DataTable`, in the
 * browser, on every keystroke, because the whole list is already on the page.
 * The facets exist once in the page (the sheet mounts its copy only while
 * open), and so does the search box `/` jumps to.
 */
export interface FilterBarProps {
  /** The search landmark's name, translated ("Filter the inventory"). */
  label: string;
  search?: { value: string; onChange: (value: string) => void; label: string; placeholder?: string };
  /** `FacetFilter`s. */
  facets?: ReactNode;
  shown: number;
  total: number;
  /** Offered while anything narrows the list. */
  onClear?: (() => void) | null;
  /** Controls that shape the list without narrowing it and move into the phone's Filters sheet (Group by, Columns). */
  secondary?: ReactNode;
  /** The end of the bar, kept in the bar on a phone too (Sort, the view switch). */
  end?: ReactNode;
  /** How many facets are set, for the phone's Filters button. Defaults to counting none. */
  activeCount?: number;
}

export function FilterBar({ label, search, facets, shown, total, onClear, secondary, end, activeCount = 0 }: FilterBarProps) {
  const t = useTranslations("ui.filters");
  const searchId = useId();
  const [sheetOpen, setSheetOpen] = useState(false);
  const offersSheet = Boolean(facets) || Boolean(secondary);

  const clear = onClear ? (
    <Button variant="ghost" size="sm" onClick={onClear}>
      <X aria-hidden="true" />
      {t("clear")}
    </Button>
  ) : null;

  return (
    <div
      role="search"
      aria-label={label}
      data-slot="filter-bar"
      // One grid, two arrangements, so the count is one live region in both:
      // phone — search / controls / count; from `sm` — search·count / controls.
      className="ui grid grid-cols-1 items-center gap-x-3 gap-y-2 pb-3 [grid-template-areas:'search'_'controls'_'count'] sm:grid-cols-[minmax(0,1fr)_auto] sm:[grid-template-areas:'search_count'_'controls_controls']"
    >
      {search ? (
        <div className="relative flex min-w-0 items-center [grid-area:search]">
          <label htmlFor={searchId} className="sr-only">
            {search.label}
          </label>
          <Search aria-hidden="true" className="pointer-events-none absolute start-2.5 size-3.5 text-muted-foreground" />
          <Input
            id={searchId}
            type="search"
            value={search.value}
            placeholder={search.placeholder}
            onChange={(event) => search.onChange(event.target.value)}
            className="h-8 ps-8 text-table"
          />
        </div>
      ) : null}

      <span
        role="status"
        className="font-mono text-micro tracking-[0.06em] whitespace-nowrap text-muted-foreground uppercase tabular-nums [grid-area:count] sm:justify-self-end sm:text-label"
      >
        {t("showing", { shown, total })}
      </span>

      <div className="flex min-w-0 flex-wrap items-center gap-2 [grid-area:controls]">
        {offersSheet ? (
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="quiet" size="sm" className="border-input sm:hidden" aria-label={t("filtersButton", { count: activeCount })}>
                <SlidersHorizontal aria-hidden="true" />
                {t("filters")}
                {activeCount > 0 ? (
                  <span aria-hidden="true" className="ms-0.5 inline-flex min-w-4 items-center justify-center bg-foreground px-1 text-background tabular-nums">
                    {activeCount}
                  </span>
                ) : null}
              </Button>
            </SheetTrigger>
            <SheetContent side="right" closeLabel={t("closeFilters")}>
              <SheetTitle>{t("filters")}</SheetTitle>
              <SheetDescription>{t("showing", { shown, total })}</SheetDescription>
              {sheetOpen ? (
                <div className="flex flex-col items-start gap-3 [&>*]:w-full [&>*]:justify-between">
                  {facets}
                  {secondary}
                </div>
              ) : null}
              <div className="mt-auto flex items-center justify-between gap-2 border-t border-rule pt-3">
                {clear}
                <Button size="sm" className="ms-auto" onClick={() => setSheetOpen(false)}>
                  {t("showResults", { count: shown })}
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        ) : null}

        <div className="hidden flex-wrap items-center gap-2 sm:flex">
          {facets}
          {clear}
        </div>

        <div className="ms-auto flex flex-wrap items-center justify-end gap-2">
          {secondary ? <span className="hidden items-center gap-2 sm:flex">{secondary}</span> : null}
          {end}
        </div>
      </div>
    </div>
  );
}
