"use client";

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { LayoutGrid, Rows3 } from "lucide-react";
import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import type { GalleryTool } from "./catalog-types";
import { TOOL_ITEM_KIND } from "../lib/db/schema/vocabulary";
import { TOOL_STATUS_KEY, ToolCard } from "./ToolCard";
import type { ToolImagePriority } from "./ToolImage";
import { GALLERY_DEFAULT_HIDDEN, useGalleryColumns } from "./gallery-columns";
import { AskMakerlabRow } from "./search/ListSearch";
import { CategoryChips } from "./home/CategoryChips";
import {
  GALLERY_STATUSES,
  hasFacetFilters,
  type GalleryGroup,
  type GallerySort,
  type GalleryState,
} from "./gallery-filters";
import { categoryChips, matchesFacet, narrowed, type CatalogueView, type Facet } from "./catalogue-view";
import { Button } from "@/components/ui/button";
import { EmptyState } from "./system/EmptyState";
import { FilterBar } from "./system/data-table/FilterBar";
import { FacetFilter } from "./system/data-table/FacetFilter";
import { ChoiceMenu, type ChoiceOption } from "./system/data-table/ChoiceMenu";
import { ColumnsMenu } from "./system/data-table/ColumnsMenu";
import { SegmentedControl } from "./system/SegmentedControl";
import { facetOptions, uniqueValues } from "./system/data-table/facet-options";

interface GalleryShellProps {
  tools: readonly GalleryTool[];
  /** The list's state (`useCatalogueState`: the URL) and what it shows. */
  state: GalleryState;
  set: (patch: Partial<GalleryState>) => void;
  view: CatalogueView;
  /** The taxonomy's top-level order, for the chips. */
  categoryOrder: readonly string[];
}

// The table view (TanStack Table under `DataTable`) loads when somebody
// switches to it; the grid everybody lands on does not carry it.
const GalleryTable = lazy(() => import("./GalleryTable").then((mod) => ({ default: mod.GalleryTable })));

/** The facets in the bar; Category is the chips above it. */
const BAR_FACETS: readonly Facet[] = ["status", "material", "location", "kind"];

/**
 * The tool list under the home page's search (UI system phase 5a; public
 * polish; student home spec 2026-10-07, amendment "One page: the list at
 * rest"). It holds no state: the home page (`HomeShell`) reads the URL and
 * hands over what to show (`catalogueView`).
 *
 * - **The bar** (`FilterBar`): the category chips (`CategoryChips`, the
 *   Category filter) with the count they leave, then Status / Material /
 *   Location / Item kind with counts, **Group by** and (in the table)
 *   **Columns**, **Sort** and the Grid / Table `SegmentedControl`.
 * - **At rest** the tools are in sections — by category group in the lab's
 *   order unless another grouping is chosen — each heading sticky under the
 *   top bar with its count, in both views.
 * - **Searching** the sections give way to the matching tools, best first,
 *   under a heading that says what was searched; Ask MakerLAB AI is offered
 *   after them, and in place of them when nothing matches.
 */
export function GalleryShell({ tools, state, set, view, categoryOrder }: GalleryShellProps) {
  const t = useTranslations("gallery");
  const columns = useGalleryColumns();
  const [visibility, setVisibility] = useState<VisibilityState>(GALLERY_DEFAULT_HIDDEN);

  const rootRef = useRef<HTMLDivElement>(null);
  useStickyOffset(rootRef);

  const { visible, shown, sections, searching } = view;
  const query = state.query.trim();
  const materials = useMemo(() => uniqueValues(visible.flatMap((tool) => tool.materials)), [visible]);
  const locations = useMemo(() => uniqueValues(visible.map((tool) => tool.location)), [visible]);
  const chips = useMemo(() => categoryChips(tools, state, categoryOrder), [tools, state, categoryOrder]);
  const allCount = useMemo(() => narrowed(visible.filter((tool) => !tool.galleryHidden), state, "category").length, [visible, state]);

  const facet = (key: Facet, label: string, values: readonly string[], valueLabel?: (value: string) => string) => (
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
  // The phone's Filters button counts what is in its sheet: not the chips.
  const activeCount = BAR_FACETS.filter((key) => state[key]).length;

  return (
    <div ref={rootRef} data-slot="tool-list">
      <FilterBar
        label={t("filterLabel")}
        lead={
          <CategoryChips
            chips={chips}
            value={state.category}
            total={allCount}
            onChange={(category) => set({ category })}
          />
        }
        facets={
          <>
            {facet("status", t("statusFacet"), GALLERY_STATUSES, statusLabel)}
            {facet("material", t("materials"), materials)}
            {facet("location", t("location"), locations)}
            {facet("kind", t("itemKindFacet"), TOOL_ITEM_KIND, kindLabel)}
          </>
        }
        activeCount={activeCount}
        shown={shown.length}
        total={visible.length}
        onClear={narrowing ? clear : null}
        secondary={
          <>
            <ChoiceMenu
              label={t("group.label")}
              value={state.group ?? "default"}
              options={groupOptions}
              onChange={(value) => set({ group: value === "default" ? null : value })}
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
              onChange={(next) => set({ view: next })}
              options={[
                { value: "grid", label: t("grid"), content: <LayoutGrid aria-hidden="true" /> },
                { value: "table", label: t("table"), content: <Rows3 aria-hidden="true" /> },
              ]}
            />
          </>
        }
      />

      {shown.length === 0 ? (
        <section aria-label={t("toolGalleryLabel")} data-slot="tool-list-empty">
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
          <AskMakerlabRow query={state.query} />
        </section>
      ) : searching ? (
        <section aria-labelledby="tool-results-heading" data-slot="tool-results">
          <SectionHeading id="tool-results-heading" label={t("results.heading", { query })} count={t("sectionCount", { count: shown.length })} />
          <Tools
            tools={shown}
            view={state.view}
            headingLevel={3}
            tableLabel={t("results.heading", { query })}
            columns={columns}
            visibility={visibility}
            leading
          />
          <div className="mt-6">
            <AskMakerlabRow query={state.query} />
          </div>
        </section>
      ) : sections.length === 1 && sections[0].label === "" ? (
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
                <SectionHeading id={id} label={section.label} count={t("sectionCount", { count: section.tools.length })} />
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
    </div>
  );
}

/** A group's heading, or the results': sticky under the top bar, the label and the count. */
function SectionHeading({ id, label, count }: { id: string; label: string; count: string }) {
  return (
    <h2
      id={id}
      className="sticky top-[var(--gallery-sticky-top,var(--nav-height))] z-10 mb-3 flex items-baseline justify-between gap-3 border-b border-rule bg-background py-2 font-mono text-label tracking-[0.08em] uppercase"
    >
      <span className="min-w-0 truncate">{label}</span>
      <span className="shrink-0 text-muted-foreground tabular-nums">{count}</span>
    </h2>
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
 * Keep the section headings just under the sticky chrome — the top bar and
 * the status strip under it — whose height changes with the viewport (the bar
 * wraps on a phone): measured, not guessed. On a short viewport nothing
 * sticks (DESIGN.md §8.12), so they stick at the top. Entering or leaving
 * that layout changes the bar's height, so the observer sees it.
 */
function useStickyOffset(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = ref.current;
    const bar = document.querySelector<HTMLElement>(".top-nav");
    if (!root || !bar || typeof ResizeObserver === "undefined") return;
    const strip = document.querySelector<HTMLElement>(".status-strip");
    const update = () => {
      const barSticks = getComputedStyle(bar).position === "sticky";
      const stripSticks = strip ? getComputedStyle(strip).position === "sticky" : false;
      const top = (barSticks ? bar.offsetHeight : 0) + (barSticks && stripSticks && strip ? strip.offsetHeight : 0);
      root.style.setProperty("--gallery-sticky-top", `${top}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(bar);
    if (strip) observer.observe(strip);
    return () => observer.disconnect();
  }, [ref]);
}
