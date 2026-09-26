"use client";

import { useEffect, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { matchSorter } from "match-sorter";
import { LayoutGrid, Rows3 } from "lucide-react";
import type { MakerLabTool } from "./catalog-types";
import { ToolCard } from "./ToolCard";
import { GalleryTable } from "./GalleryTable";
import { GalleryHero } from "./GalleryHero";
import {
  availableUnits,
  groupTools,
  hasFacetFilters,
  parseGalleryState,
  sortTools,
  toGallerySearchParams,
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
import { facetOptions, uniqueValues } from "./system/data-table/facet-options";
import { cn } from "@/lib/utils";

interface GalleryShellProps {
  tools: MakerLabTool[];
}

// Ranked, typo-tolerant search keys. match-sorter ranks earlier keys above
// later ones when match quality ties, so key order doubles as relevance
// weight: name first, then the structured metadata (category / tags /
// materials), then the free-text description last.
const SEARCH_KEYS: ReadonlyArray<keyof MakerLabTool> = [
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

type Facet = "category" | "material" | "location";

function matchesFacet(tool: MakerLabTool, facet: Facet, value: string): boolean {
  if (facet === "category") return tool.category === value;
  if (facet === "material") return tool.materials.includes(value);
  return tool.location === value;
}

/** The rows every facet but `except` leaves — what a facet's counts are taken over. */
function narrowed(tools: readonly MakerLabTool[], state: GalleryState, except?: Facet): MakerLabTool[] {
  return tools.filter((tool) =>
    (["category", "material", "location"] as const).every(
      (facet) => facet === except || !state[facet] || matchesFacet(tool, facet, state[facet]!)
    )
  );
}

/**
 * The gallery (UI system phase 5a): the display hero with a facts line, then a
 * `FilterBar` — search, Category / Material / Location facets with counts,
 * **Sort** and **Group by** (owner request 2026-09-25), and the grid/table
 * view — over the card grid or the `DataTable`.
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

  const mainRef = useRef<HTMLElement>(null);
  useStickyOffset(mainRef);

  const categories = useMemo(() => uniqueValues(tools.map((tool) => tool.category)), [tools]);
  const materials = useMemo(() => uniqueValues(tools.flatMap((tool) => tool.materials)), [tools]);
  const locations = useMemo(() => uniqueValues(tools.map((tool) => tool.location)), [tools]);

  const query = state.query.trim();
  const shownTools = useMemo(() => {
    const faceted = narrowed(tools, state);
    // Empty query keeps the catalogue's order; a query ranks by fuzzy match.
    const ranked = query ? matchSorter(faceted, query, { keys: SEARCH_KEYS.slice() }) : faceted;
    return sortTools(ranked, state.sort);
  }, [tools, state, query]);
  const sections = useMemo(() => groupTools(shownTools, state.group), [shownTools, state.group]);

  const facts = useMemo(() => {
    const available = tools.filter((tool) => availableUnits(tool) > 0).length;
    return [
      t("facts.tools", { count: tools.length }),
      t("facts.available", { count: available }),
      t("facts.categories", { count: categories.length }),
    ].join(" · ");
  }, [tools, categories.length, t]);

  const facet = (key: Facet, label: string, values: string[]) => (
    <FacetFilter
      label={label}
      value={state[key]}
      options={facetOptions(narrowed(tools, state, key), values, (tool, value) => matchesFacet(tool, key, value))}
      onChange={(value) => set({ [key]: value })}
    />
  );

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
    state.category ? `${t("category")}: ${state.category}` : null,
    state.material ? `${t("materials")}: ${state.material}` : null,
    state.location ? `${t("location")}: ${state.location}` : null,
  ].filter(Boolean);
  const narrowing = Boolean(query) || hasFacetFilters(state);
  const clear = () => set({ query: "", category: null, material: null, location: null });

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
            {facet("category", t("category"), categories)}
            {facet("material", t("materials"), materials)}
            {facet("location", t("location"), locations)}
          </>
        }
        shown={shownTools.length}
        total={tools.length}
        onClear={narrowing ? clear : null}
        end={
          <>
            <ChoiceMenu
              label={t("sort.label")}
              value={state.sort ?? "default"}
              options={sortOptions}
              onChange={(value) => set({ sort: value === "default" ? null : value })}
            />
            <ChoiceMenu
              label={t("group.label")}
              value={state.group ?? "none"}
              options={groupOptions}
              onChange={(value) => set({ group: value === "none" ? null : value })}
            />
            <div role="group" aria-label={t("viewModeLabel")} className="flex">
              {(["grid", "table"] as const).map((view) => (
                <Button
                  key={view}
                  size="icon-sm"
                  variant={state.view === view ? "outline" : "quiet"}
                  aria-pressed={state.view === view}
                  aria-label={t(view === "grid" ? "grid" : "table")}
                  title={t(view === "grid" ? "grid" : "table")}
                  className={cn(view === "table" && "-ms-px", state.view === view && "border-primary-ink")}
                  onClick={() => set({ view })}
                >
                  {view === "grid" ? <LayoutGrid aria-hidden="true" /> : <Rows3 aria-hidden="true" />}
                </Button>
              ))}
            </div>
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
          <Tools tools={sections[0].tools} view={state.view} headingLevel={2} tableLabel={t("toolGalleryLabel")} />
        </section>
      ) : (
        <div className="flex flex-col gap-6" data-slot="gallery-sections">
          {sections.map((section, index) => {
            const id = `gallery-section-${index}`;
            return (
              <section key={section.key} aria-labelledby={id} data-slot="gallery-section">
                <h2
                  id={id}
                  className="sticky top-[var(--gallery-sticky-top,64px)] z-10 mb-3 flex items-baseline justify-between gap-3 border-b border-rule bg-background py-2 font-mono text-label tracking-[0.08em] uppercase"
                >
                  <span>{section.label}</span>
                  <span className="text-muted-foreground tabular-nums">{t("sectionCount", { count: section.tools.length })}</span>
                </h2>
                <Tools
                  tools={section.tools}
                  view={state.view}
                  headingLevel={3}
                  tableLabel={t("sectionTable", { section: section.label })}
                  stickyHeader={false}
                  keyboardHint={index === sections.length - 1}
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
  stickyHeader,
  keyboardHint,
}: {
  tools: MakerLabTool[];
  view: GalleryState["view"];
  headingLevel: 2 | 3;
  tableLabel: string;
  stickyHeader?: boolean;
  keyboardHint?: boolean;
}) {
  if (view === "table") {
    return <GalleryTable tools={tools} label={tableLabel} stickyHeader={stickyHeader} keyboardHint={keyboardHint} />;
  }
  return (
    <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:gap-4 md:grid-cols-3 xl:grid-cols-5">
      {tools.map((tool) => (
        <li key={tool.id} className="min-w-0">
          <ToolCard tool={tool} headingLevel={headingLevel} />
        </li>
      ))}
    </ul>
  );
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
