"use client";

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { matchSorter } from "match-sorter";
import { LayoutGrid, Rows3 } from "lucide-react";
import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import type { GalleryTool } from "./catalog-types";
import { TOOL_ITEM_KIND } from "../lib/db/schema/vocabulary";
import { TOOL_STATUS_KEY, ToolCard } from "./ToolCard";
import type { ToolImagePriority } from "./ToolImage";
import { GALLERY_DEFAULT_HIDDEN, useGalleryColumns } from "./gallery-columns";
import { GalleryHero } from "./GalleryHero";
import {
  GALLERY_STATUSES,
  availableUnits,
  groupTools,
  hasFacetFilters,
  parseGalleryState,
  sortTools,
  toGallerySearchParams,
  visibleInGallery,
  type GalleryGroup,
  type GallerySort,
  type GalleryState,
} from "./gallery-filters";
import { useUrlSearch } from "./use-url-state";
import { Button } from "@/components/ui/button";
import { EmptyState } from "./system/EmptyState";
import { FilterBar } from "./system/data-table/FilterBar";
import { FacetFilter } from "./system/data-table/FacetFilter";
import { ChoiceMenu, type ChoiceOption } from "./system/data-table/ChoiceMenu";
import { ColumnsMenu } from "./system/data-table/ColumnsMenu";
import { SegmentedControl } from "./system/SegmentedControl";
import { facetOptions, uniqueValues } from "./system/data-table/facet-options";

interface GalleryShellProps {
  tools: GalleryTool[];
}

// The table view (TanStack Table under `DataTable`) loads when somebody
// switches to it; the grid everybody lands on does not carry it.
const GalleryTable = lazy(() => import("./GalleryTable").then((mod) => ({ default: mod.GalleryTable })));

// Ranked, typo-tolerant search keys. match-sorter ranks earlier keys above
// later ones when match quality ties, so key order doubles as relevance
// weight: name first, then the structured metadata (category / tags /
// materials), then the free-text description last.
const SEARCH_KEYS: ReadonlyArray<keyof GalleryTool> = [
  "name",
  // The official name, with its model or part number (tool display names spec §5.6).
  "officialName",
  "category",
  "categorySub",
  "tags",
  "materials",
  "location",
  "zone",
  "ppe",
  "trainingLevel",
  "description",
];

type Facet = "status" | "category" | "material" | "location" | "kind";
const FACETS: readonly Facet[] = ["status", "category", "material", "location", "kind"];

function matchesFacet(tool: GalleryTool, facet: Facet, value: string): boolean {
  if (facet === "status") return tool.status === value;
  if (facet === "category") return tool.category === value;
  if (facet === "material") return tool.materials.includes(value);
  if (facet === "kind") return (tool.itemKind ?? "equipment") === value;
  return tool.location === value;
}

/** The rows every facet but `except` leaves — what a facet's counts are taken over. */
function narrowed(tools: readonly GalleryTool[], state: GalleryState, except?: Facet): GalleryTool[] {
  return tools.filter((tool) =>
    FACETS.every(
      (facet) => facet === except || !state[facet] || matchesFacet(tool, facet, state[facet]!)
    )
  );
}

/**
 * The gallery (UI system phase 5a; public polish): the display hero with a
 * facts line, then the shared `FilterBar` — search, Status / Category /
 * Material / Location facets with counts, **Group by** and (in the table)
 * **Columns**, **Sort** and the Grid / Table `SegmentedControl` — over the
 * card grid or the `DataTable`. One filter state, in the URL, drives both
 * views; the table view is the inventory's controls for the public list.
 *
 * Grouped, the gallery is labelled sections in order, each heading sticky
 * under the top bar with its count (small multiples), in both views. Every
 * choice is in the URL (`gallery-filters.ts`, `useUrlSearch`), so a view is a
 * link; the page stays one cached prerender for everybody.
 */
export function GalleryShell({ tools }: GalleryShellProps) {
  const t = useTranslations("gallery");
  const [search, writeSearch] = useUrlSearch();
  const state = useMemo(() => parseGalleryState(new URLSearchParams(search)), [search]);
  const set = (patch: Partial<GalleryState>) => writeSearch(toGallerySearchParams({ ...state, ...patch }));

  const columns = useGalleryColumns();
  const [visibility, setVisibility] = useState<VisibilityState>(GALLERY_DEFAULT_HIDDEN);

  const mainRef = useRef<HTMLElement>(null);
  useStickyOffset(mainRef);

  // Hidden-by-default categories stay out unless the Category facet names one
  // (taxonomy v2); the Category facet itself still lists them, with counts.
  const visible = useMemo(() => visibleInGallery(tools, state), [tools, state]);
  const categories = useMemo(() => uniqueValues(tools.map((tool) => tool.category)), [tools]);
  const materials = useMemo(() => uniqueValues(visible.flatMap((tool) => tool.materials)), [visible]);
  const locations = useMemo(() => uniqueValues(visible.map((tool) => tool.location)), [visible]);

  const query = state.query.trim();
  const shownTools = useMemo(() => {
    const faceted = narrowed(visible, state);
    // Empty query keeps the catalogue's order; a query ranks by fuzzy match.
    const ranked = query ? matchSorter(faceted, query, { keys: SEARCH_KEYS.slice() }) : faceted;
    return sortTools(ranked, state.sort);
  }, [visible, state, query]);
  const sections = useMemo(() => groupTools(shownTools, state.group), [shownTools, state.group]);

  const facts = useMemo(() => {
    const available = visible.filter((tool) => availableUnits(tool) > 0).length;
    return [
      t("facts.tools", { count: visible.length }),
      t("facts.available", { count: available }),
      t("facts.categories", { count: categories.length }),
    ].join(" · ");
  }, [visible, categories.length, t]);

  const facet = (key: Facet, label: string, values: readonly string[], valueLabel?: (value: string) => string) => (
    <FacetFilter
      label={label}
      value={state[key]}
      options={facetOptions(narrowed(key === "category" ? tools : visible, state, key), values, (tool, value) => matchesFacet(tool, key, value), valueLabel)}
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
  const groupOptions: ChoiceOption<"none" | GalleryGroup>[] = [
    { value: "none", label: t("group.none") },
    { value: "category", label: t("group.category") },
    { value: "categoryGroup", label: t("group.categoryGroup") },
    { value: "location", label: t("group.location") },
  ];

  const activeWords = [
    query ? `"${query}"` : null,
    state.status ? `${t("statusFacet")}: ${statusLabel(state.status)}` : null,
    state.category ? `${t("category")}: ${state.category}` : null,
    state.material ? `${t("materials")}: ${state.material}` : null,
    state.location ? `${t("location")}: ${state.location}` : null,
    state.kind ? `${t("itemKindFacet")}: ${kindLabel(state.kind)}` : null,
  ].filter(Boolean);
  const narrowing = Boolean(query) || hasFacetFilters(state);
  const clear = () => set({ query: "", status: null, category: null, material: null, location: null, kind: null });
  const activeCount = FACETS.filter((key) => state[key]).length;

  return (
    <main ref={mainRef} className="ui mx-auto w-full max-w-[1440px] px-4 pb-16 sm:px-8">
      <GalleryHero title={t("title")} facts={facts} />

      <FilterBar
        label={t("filterLabel")}
        search={{
          value: state.query,
          onChange: (value) => set({ query: value }),
          label: t("searchAria"),
          placeholder: t("searchPlaceholder"),
        }}
        facets={
          <>
            {facet("status", t("statusFacet"), GALLERY_STATUSES, statusLabel)}
            {facet("category", t("category"), categories)}
            {facet("material", t("materials"), materials)}
            {facet("location", t("location"), locations)}
            {facet("kind", t("itemKindFacet"), TOOL_ITEM_KIND, kindLabel)}
          </>
        }
        activeCount={activeCount}
        shown={shownTools.length}
        total={visible.length}
        onClear={narrowing ? clear : null}
        secondary={
          <>
            <ChoiceMenu
              label={t("group.label")}
              value={state.group ?? "none"}
              options={groupOptions}
              onChange={(value) => set({ group: value === "none" ? null : value })}
            />
            {state.view === "table" ? <ColumnsMenu columns={columns} visibility={visibility} onChange={setVisibility} /> : null}
          </>
        }
        end={
          <>
            <ChoiceMenu
              label={t("sort.label")}
              value={state.sort ?? "default"}
              options={sortOptions}
              onChange={(value) => set({ sort: value === "default" ? null : value })}
            />
            <SegmentedControl
              label={t("viewModeLabel")}
              value={state.view}
              onChange={(view) => set({ view })}
              options={[
                { value: "grid", label: t("grid"), content: <LayoutGrid aria-hidden="true" /> },
                { value: "table", label: t("table"), content: <Rows3 aria-hidden="true" /> },
              ]}
            />
          </>
        }
      />

      {shownTools.length === 0 ? (
        <section aria-label={t("toolGalleryLabel")}>
          <EmptyState
            action={
              narrowing ? (
                <Button size="sm" onClick={clear}>
                  {t("clearFilters")}
                </Button>
              ) : null
            }
          >
            {narrowing ? t("emptyFiltered", { filters: activeWords.join(" · ") }) : t("empty")}
          </EmptyState>
        </section>
      ) : state.group === null ? (
        <section aria-label={t("toolGalleryLabel")}>
          <Tools
            tools={sections[0].tools}
            view={state.view}
            headingLevel={2}
            tableLabel={t("toolGalleryLabel")}
            columns={columns}
            visibility={visibility}
            leading
          />
        </section>
      ) : (
        <div className="flex flex-col gap-6" data-slot="gallery-sections">
          {sections.map((section, index) => {
            const id = `gallery-section-${index}`;
            return (
              <section key={section.key} aria-labelledby={id} data-slot="gallery-section">
                <h2
                  id={id}
                  className="sticky top-[var(--gallery-sticky-top,var(--nav-height))] z-10 mb-3 flex items-baseline justify-between gap-3 border-b border-rule bg-background py-2 font-mono text-label tracking-[0.08em] uppercase"
                >
                  <span>{section.label}</span>
                  <span className="text-muted-foreground tabular-nums">{t("sectionCount", { count: section.tools.length })}</span>
                </h2>
                <Tools
                  tools={section.tools}
                  view={state.view}
                  headingLevel={3}
                  tableLabel={t("sectionTable", { section: section.label })}
                  columns={columns}
                  visibility={visibility}
                  stickyHeader={false}
                  keyboardHint={index === sections.length - 1}
                  leading={index === 0}
                />
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}

function Tools({
  tools,
  view,
  headingLevel,
  tableLabel,
  columns,
  visibility,
  stickyHeader,
  keyboardHint,
  leading = false,
}: {
  tools: GalleryTool[];
  view: GalleryState["view"];
  headingLevel: 2 | 3;
  tableLabel: string;
  columns: ColumnDef<GalleryTool, unknown>[];
  visibility: VisibilityState;
  stickyHeader?: boolean;
  keyboardHint?: boolean;
  /** The first list on the page: its first row's images are fetched eagerly. */
  leading?: boolean;
}) {
  if (view === "table") {
    return (
      <Suspense fallback={<p className="py-6 font-mono text-label text-muted-foreground uppercase">{tableLabel}</p>}>
        <GalleryTable
          tools={tools}
          columns={columns}
          visibility={visibility}
          label={tableLabel}
          stickyHeader={stickyHeader}
          keyboardHint={keyboardHint}
        />
      </Suspense>
    );
  }
  return (
    <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:gap-4 md:grid-cols-3 xl:grid-cols-5">
      {tools.map((tool, index) => (
        <li key={tool.id} className="min-w-0">
          <ToolCard tool={tool} headingLevel={headingLevel} imagePriority={leading ? cardImagePriority(index) : "lazy"} />
        </li>
      ))}
    </ul>
  );
}

/**
 * The first row is fetched eagerly and everything below it lazily. A row is
 * two cards on a phone and five on a wide screen, so the first two — the
 * likely LCP image on any screen — are `high`, the next three `eager`.
 */
export function cardImagePriority(index: number): ToolImagePriority {
  if (index < 2) return "high";
  return index < 5 ? "eager" : "lazy";
}

/**
 * Keep the section headings just under the sticky top bar, whose height
 * changes with the viewport (it wraps on a phone): measured, not guessed.
 */
function useStickyOffset(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const main = ref.current;
    const bar = document.querySelector<HTMLElement>(".top-nav");
    if (!main || !bar || typeof ResizeObserver === "undefined") return;
    const update = () => main.style.setProperty("--gallery-sticky-top", `${bar.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [ref]);
}
