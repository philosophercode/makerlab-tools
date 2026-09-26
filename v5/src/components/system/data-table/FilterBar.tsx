"use client";

import { useId, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * The filter bar every list shares (UI system spec §7.2; DESIGN.md §8.4):
 * search on the left, one `FacetFilter` per dimension, Clear while anything
 * narrows the list, then `Showing 12 of 101` and the `ColumnsMenu` at the end.
 *
 * It owns no filter state. The caller holds it — the inventory writes it to
 * the URL (`inventory-filters.ts`) so a view is a link — and filters the rows
 * it hands the `DataTable`, in the browser, on every keystroke, because the
 * whole list is already on the page.
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
  /** The end of the bar: usually a `ColumnsMenu`. */
  end?: ReactNode;
}

export function FilterBar({ label, search, facets, shown, total, onClear, end }: FilterBarProps) {
  const t = useTranslations("ui.filters");
  const searchId = useId();
  return (
    <div role="search" aria-label={label} className="ui flex flex-wrap items-center gap-2 pb-3">
      {search ? (
        <div className="relative flex min-w-0 flex-1 basis-56 items-center sm:max-w-72">
          <label htmlFor={searchId} className="sr-only">
            {search.label}
          </label>
          <Search aria-hidden="true" className="pointer-events-none absolute start-2 size-3.5 text-muted-foreground" />
          <Input
            id={searchId}
            type="search"
            value={search.value}
            placeholder={search.placeholder}
            onChange={(event) => search.onChange(event.target.value)}
            className="h-7 ps-7 text-table"
          />
        </div>
      ) : null}
      {facets}
      {onClear ? (
        <Button variant="ghost" size="sm" onClick={onClear}>
          <X aria-hidden="true" />
          {t("clear")}
        </Button>
      ) : null}
      <span className="ms-auto flex max-w-full flex-wrap items-center justify-end gap-2">
        <span role="status" className="font-mono text-label whitespace-nowrap text-muted-foreground tabular-nums">
          {t("showing", { shown, total })}
        </span>
        {end}
      </span>
    </div>
  );
}
