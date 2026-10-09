"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { LayoutGrid, Rows3, X } from "lucide-react";
import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import type { GalleryTool } from "../catalog-types";
import { TOOL_ITEM_KIND } from "../../lib/db/schema/vocabulary";
import { TOOL_STATUS_KEY } from "../ToolCard";
import { GALLERY_STATUSES, type GalleryGroup, type GallerySort, type GalleryState } from "../gallery-filters";
import { activeFilterCount, categoryChips, matchesFacet, narrowed, type CatalogueView, type Facet } from "../catalogue-view";
import { Button } from "@/components/ui/button";
import { FacetFilter } from "../system/data-table/FacetFilter";
import { ChoiceMenu, type ChoiceOption } from "../system/data-table/ChoiceMenu";
import { ColumnsMenu } from "../system/data-table/ColumnsMenu";
import { SegmentedControl } from "../system/SegmentedControl";
import { facetOptions, uniqueValues } from "../system/data-table/facet-options";

/**
 * The home page's Filters panel (student home spec, amendment "One page: the
 * list at rest", revised): hidden until the Filters button opens it (or the
 * URL arrives with a filter set). It holds every control the list has, so the
 * page itself has none: **Category** (a menu, in the lab's order, with
 * counts), **Status**, **Material**, **Location**, **Item kind**; then **Group
 * by** (All tools only), **Columns** (the table only), **Sort** and **Grid /
 * Table**; then the count and **Clear filters** while any is set.
 *
 * A search landmark ("Filter the tools"), so `/` and a screen reader's
 * landmarks find it; kept in the DOM while closed (`hidden`) so the button's
 * `aria-controls` always names it.
 */
export function FiltersPanel({
  id,
  open,
  tools,
  state,
  set,
  view,
  categoryOrder,
  columns,
  visibility,
  onVisibility,
}: {
  id: string;
  open: boolean;
  tools: readonly GalleryTool[];
  state: GalleryState;
  set: (patch: Partial<GalleryState>) => void;
  view: CatalogueView;
  categoryOrder: readonly string[];
  columns: ColumnDef<GalleryTool, unknown>[];
  visibility: VisibilityState;
  onVisibility: (next: VisibilityState) => void;
}) {
  const t = useTranslations("gallery");
  const tFilters = useTranslations("ui.filters");
  const { visible, shown, total } = view;
  const query = state.query.trim();

  const materials = useMemo(() => uniqueValues(visible.flatMap((tool) => tool.materials)), [visible]);
  const locations = useMemo(() => uniqueValues(visible.map((tool) => tool.location)), [visible]);
  const categories = useMemo(
    () => categoryChips(tools, state, categoryOrder).map((chip) => ({ value: chip.name, label: chip.name, count: chip.count })),
    [tools, state, categoryOrder]
  );

  const facet = (key: Exclude<Facet, "category">, label: string, values: readonly string[], valueLabel?: (value: string) => string) => (
    <FacetFilter
      label={label}
      value={state[key]}
      options={facetOptions(narrowed(visible, state, key), values, (tool, value) => matchesFacet(tool, key, value), valueLabel)}
      onChange={(value) => set({ [key]: value })}
    />
  );
  const statusLabel = (value: string) => t(`status.${TOOL_STATUS_KEY[value as GalleryTool["status"]]}`);
  const kindLabel = (value: string) => t(`itemKind.${value}`);

  const sortOptions: ChoiceOption<"default" | GallerySort>[] = [
    { value: "default", label: query ? t("sort.relevance") : t("sort.name") },
    ...(query ? [{ value: "name" as const, label: t("sort.name") }] : []),
    { value: "name-desc", label: t("sort.nameDesc") },
    { value: "category", label: t("sort.category") },
    { value: "location", label: t("sort.location") },
    { value: "recent", label: t("sort.recent") },
    { value: "available", label: t("sort.available") },
  ];
  // The default (`null`) is by category group, in the lab's order.
  const groupOptions: ChoiceOption<"default" | Exclude<GalleryGroup, "categoryGroup">>[] = [
    { value: "default", label: t("group.categoryGroup") },
    { value: "category", label: t("group.category") },
    { value: "location", label: t("group.location") },
    { value: "none", label: t("group.none") },
  ];

  const active = activeFilterCount(state);
  const clear = () => set({ status: null, category: null, material: null, location: null, kind: null });

  return (
    <div id={id} role="search" aria-label={t("filterLabel")} hidden={!open} data-slot="filters-panel" className="ui w-full border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <FacetFilter label={t("category")} value={state.category} options={categories} onChange={(category) => set({ category })} />
        {facet("status", t("statusFacet"), GALLERY_STATUSES, statusLabel)}
        {facet("material", t("materials"), materials)}
        {facet("location", t("location"), locations)}
        {facet("kind", t("itemKindFacet"), TOOL_ITEM_KIND, kindLabel)}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {state.show === "all" && !query ? (
          <ChoiceMenu
            label={t("group.label")}
            value={state.group ?? "default"}
            options={groupOptions}
            onChange={(value) => set({ group: value === "default" ? null : value })}
          />
        ) : null}
        <ChoiceMenu
          label={t("sort.label")}
          value={state.sort ?? "default"}
          options={sortOptions}
          onChange={(value) => set({ sort: value === "default" ? null : value })}
        />
        <SegmentedControl
          label={t("viewModeLabel")}
          value={state.view}
          onChange={(next) => set({ view: next })}
          options={[
            { value: "grid", label: t("grid"), content: <LayoutGrid aria-hidden="true" /> },
            { value: "table", label: t("table"), content: <Rows3 aria-hidden="true" /> },
          ]}
        />
        {state.view === "table" ? <ColumnsMenu columns={columns} visibility={visibility} onChange={onVisibility} /> : null}
      </div>
      <div className="mt-3 flex min-h-7 items-center justify-between gap-3 border-t border-rule pt-2">
        <span role="status" className="font-mono text-micro tracking-[0.06em] text-muted-foreground uppercase tabular-nums sm:text-label">
          {tFilters("showing", { shown: shown.length, total })}
        </span>
        {active > 0 ? (
          <Button variant="ghost" size="sm" onClick={clear}>
            <X aria-hidden="true" />
            {tFilters("clear")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
