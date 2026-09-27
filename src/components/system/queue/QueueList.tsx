"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { EmptyState } from "../EmptyState";
import { FacetFilter } from "../data-table/FacetFilter";
import { FilterBar } from "../data-table/FilterBar";
import { facetOptions } from "../data-table/facet-options";

/**
 * The one queue layout (UI system spec §8.1; DESIGN.md §8.13): maintenance,
 * corrections, projects and the intake queue are lists of cards somebody
 * works through, and they share one shape so a difference between them is a
 * difference in the work, not in the page.
 *
 *   [search] [FACET ▾] [FACET ▾] [Clear]                  Showing 4 of 9
 *   the open work, one card each (the caller's `renderItem`)
 *   ▸ 5 SETTLED                      ← a disclosure, the settled work in it
 *
 * **Open work is the page; settled work is one click away** (the queues' rule
 * since spec §5.6): somebody with twenty tickets and ten minutes wants the
 * open ones, and "what did we do last time" is a disclosure, not a search.
 *
 * **Filtering is in the browser** (the whole queue is already on the page),
 * over both halves: a facet menu counts each value given the other filters,
 * and a filter that empties the open list says which filter did it, with
 * Clear — never a bare "no results" (DESIGN.md §8.9). The bar is left out of
 * an empty queue, which says what is missing instead.
 *
 * Layout only: the caller owns each card and what its controls do, and may
 * group the open or settled cards (`renderList`; intake groups by batch).
 */
export interface QueueFacet<T> {
  id: string;
  /** The dimension, translated. */
  label: string;
  values: readonly string[];
  valueLabel: (value: string) => string;
  matches: (item: T, value: string) => boolean;
}

export interface QueueListProps<T> {
  items: readonly T[];
  getId: (item: T) => string;
  /** Still somebody's work — on the page rather than behind the disclosure. */
  isOpen: (item: T) => boolean;
  renderItem: (item: T) => ReactNode;
  /** Lay out a run of cards (open or settled) — batches, say. Default: a plain list. */
  renderList?: (items: T[], part: "open" | "settled") => ReactNode;
  /** The text a search matches: title, tool, body, who. */
  searchText?: (item: T) => string;
  facets?: readonly QueueFacet<T>[];
  labels: {
    /** The open list's accessible name. */
    list: string;
    /** The filter bar's landmark name. */
    filters: string;
    search?: string;
    searchPlaceholder?: string;
    /** The disclosure's summary, given how many settled items it holds. */
    settled: (count: number) => string;
    /** Nothing in the queue at all: what is missing and what would fill it. */
    empty: ReactNode;
    /** Nothing open, some settled. */
    emptyOpen: ReactNode;
  };
}

export function QueueList<T>({
  items,
  getId,
  isOpen,
  renderItem,
  renderList,
  searchText,
  facets = [],
  labels,
}: QueueListProps<T>) {
  const t = useTranslations("ui.queue");
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<Record<string, string | null>>({});

  const needle = query.trim().toLowerCase();
  const active = facets.filter((facet) => chosen[facet.id]);
  const filtering = needle.length > 0 || active.length > 0;

  const passes = useMemo(() => {
    return (item: T, except: string | null) =>
      (!needle || (searchText?.(item) ?? "").toLowerCase().includes(needle)) &&
      facets.every((facet) => {
        const value = chosen[facet.id];
        return facet.id === except || !value || facet.matches(item, value);
      });
  }, [needle, searchText, facets, chosen]);

  const shown = items.filter((item) => passes(item, null));
  const open = shown.filter(isOpen);
  const settled = shown.filter((item) => !isOpen(item));

  if (items.length === 0) return <EmptyState>{labels.empty}</EmptyState>;

  const clear = () => {
    setQuery("");
    setChosen({});
  };
  const list = (part: "open" | "settled", run: T[]) =>
    renderList ? (
      renderList(run, part)
    ) : (
      <ul aria-label={part === "open" ? labels.list : undefined} className="m-0 flex list-none flex-col p-0">
        {run.map((item) => (
          <li key={getId(item)}>{renderItem(item)}</li>
        ))}
      </ul>
    );
  const filterWords = active.map((facet) => `${facet.label}: ${facet.valueLabel(chosen[facet.id] as string)}`);
  if (needle) filterWords.unshift(t("searchFor", { query: query.trim() }));

  return (
    <div data-slot="queue-list" className="ui flex flex-col gap-4">
      {searchText || facets.length > 0 ? (
        <FilterBar
          label={labels.filters}
          search={
            searchText
              ? { value: query, onChange: setQuery, label: labels.search ?? t("search"), placeholder: labels.searchPlaceholder }
              : undefined
          }
          facets={facets.map((facet) => (
            <FacetFilter
              key={facet.id}
              label={facet.label}
              value={chosen[facet.id] ?? null}
              options={facetOptions(
                items.filter((item) => passes(item, facet.id)),
                facet.values,
                facet.matches,
                facet.valueLabel
              )}
              onChange={(value) => setChosen((current) => ({ ...current, [facet.id]: value }))}
            />
          ))}
          shown={shown.length}
          total={items.length}
          onClear={filtering ? clear : null}
        />
      ) : null}

      {open.length > 0 ? (
        list("open", open)
      ) : filtering ? (
        <EmptyState
          action={
            <Button variant="ghost" size="sm" onClick={clear}>
              {t("clear")}
            </Button>
          }
        >
          {t("noMatch", { filters: filterWords.join(" · ") })}
        </EmptyState>
      ) : (
        <EmptyState>{labels.emptyOpen}</EmptyState>
      )}

      {settled.length > 0 ? (
        <details data-slot="queue-settled" className="group/settled">
          <summary className="cursor-pointer py-2 font-mono text-label tracking-[0.08em] text-muted-foreground uppercase hover:text-foreground">
            {labels.settled(settled.length)}
          </summary>
          <div className="pt-2">{list("settled", settled)}</div>
        </details>
      ) : null}
    </div>
  );
}
