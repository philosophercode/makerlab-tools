"use client";

import { lazy, Suspense, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import type { GalleryTool } from "./catalog-types";
import { TOOL_STATUS_KEY, ToolCard } from "./ToolCard";
import type { ToolImagePriority } from "./ToolImage";
import { AskMakerlabRow } from "./search/ListSearch";
import { CategoryTileCard } from "./home/CategoryTileCard";
import { hasFacetFilters, type GalleryState } from "./gallery-filters";
import type { CatalogueView } from "./catalogue-view";
import type { UrlWriteOptions } from "./use-url-state";
import { Button } from "@/components/ui/button";
import { EmptyState } from "./system/EmptyState";

interface GalleryShellProps {
  /** The page's state (`useCatalogueState`: the URL) and what it shows. */
  state: GalleryState;
  set: (patch: Partial<GalleryState>, options?: UrlWriteOptions) => void;
  view: CatalogueView;
  /** The table's columns and which are shown (the Filters panel's Columns menu changes them). */
  columns: ColumnDef<GalleryTool, unknown>[];
  visibility: VisibilityState;
}

// The table view (TanStack Table under `DataTable`) loads when somebody
// switches to it; the grid everybody lands on does not carry it.
const GalleryTable = lazy(() => import("./GalleryTable").then((mod) => ({ default: mod.GalleryTable })));

/**
 * The home page's content under the search (UI system phase 5a; student home
 * spec 2026-10-07, amendment "One page: the list at rest", revised). It holds
 * no state: `HomeShell` reads the URL and hands over what to show
 * (`catalogueView`), and every control lives in the Filters panel.
 *
 * - **Categories** (the default): the category tiles. A tile opens its
 *   category's tools in place — a new history entry, so Back returns — under
 *   the category's name, with **All categories** to go back.
 * - **All tools**: the tools in sections, by category group in the lab's
 *   order unless another grouping is chosen, each heading sticky under the
 *   top bar with its count, in the grid or the table.
 * - **Searching**, in either view: the matching tools, best first, under a
 *   heading that says what was searched; Ask MakerLAB AI after them, and in
 *   place of them when nothing matches.
 */
export function GalleryShell({ state, set, view, columns, visibility }: GalleryShellProps) {
  const t = useTranslations("gallery");
  const rootRef = useRef<HTMLDivElement>(null);
  useStickyOffset(rootRef);

  const { mode, shown, sections, tiles } = view;
  const query = state.query.trim();
  const narrowing = Boolean(query) || hasFacetFilters(state);
  const clear = () => set({ query: "", status: null, category: null, material: null, location: null, kind: null });

  /** Open or leave a category from the tiles: a history entry, and its top in view. */
  const openCategory = (category: string | null) => {
    set({ category }, { push: true });
    requestAnimationFrame(() => {
      const root = rootRef.current;
      if (root && root.getBoundingClientRect().top < 0) root.scrollIntoView({ block: "start" });
    });
  };

  const empty = mode === "tiles" ? tiles.length === 0 : shown.length === 0;
  const activeWords = [
    query ? `"${query}"` : null,
    state.status ? `${t("statusFacet")}: ${t(`status.${TOOL_STATUS_KEY[state.status]}`)}` : null,
    state.category ? `${t("category")}: ${state.category}` : null,
    state.material ? `${t("materials")}: ${state.material}` : null,
    state.location ? `${t("location")}: ${state.location}` : null,
    state.kind ? `${t("itemKindFacet")}: ${t(`itemKind.${state.kind}`)}` : null,
  ].filter(Boolean);

  return (
    <div ref={rootRef} data-slot="tool-list" className="scroll-mt-[var(--sticky-chrome-height)]">
      {mode === "category" ? (
        <CategoryHeader name={state.category ?? ""} count={t("sectionCount", { count: shown.length })} onBack={() => openCategory(null)} />
      ) : null}

      {empty ? (
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
      ) : mode === "tiles" ? (
        <ul aria-label={t("search.categories")} className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4" data-slot="category-tiles">
          {tiles.map((tile, index) => (
            <li key={tile.name} className="min-w-0">
              <CategoryTileCard tile={tile} imagePriority={index < 2 ? "high" : index < 4 ? "eager" : "lazy"} onSelect={openCategory} />
            </li>
          ))}
        </ul>
      ) : mode === "results" ? (
        <section aria-labelledby="tool-results-heading" data-slot="tool-results">
          <SectionHeading id="tool-results-heading" label={t("results.heading", { query })} count={t("sectionCount", { count: shown.length })} />
          <Tools tools={shown} view={state.view} headingLevel={3} tableLabel={t("results.heading", { query })} columns={columns} visibility={visibility} leading />
          <div className="mt-6">
            <AskMakerlabRow query={state.query} />
          </div>
        </section>
      ) : mode === "category" ? (
        <section aria-labelledby="category-heading" data-slot="category-tools">
          <Tools tools={shown} view={state.view} headingLevel={3} tableLabel={t("sectionTable", { section: state.category ?? "" })} columns={columns} visibility={visibility} leading />
        </section>
      ) : sections.length === 1 && sections[0].label === "" ? (
        <section aria-label={t("toolGalleryLabel")}>
          <Tools tools={sections[0].tools} view={state.view} headingLevel={2} tableLabel={t("toolGalleryLabel")} columns={columns} visibility={visibility} leading />
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

/** A category opened from its tile: the way back, its name and its count. */
function CategoryHeader({ name, count, onBack }: { name: string; count: string; onBack: () => void }) {
  const t = useTranslations("gallery");
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-1 border-b border-rule pb-3" data-slot="category-header">
      <div className="flex min-w-0 flex-col items-start gap-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex cursor-pointer items-center gap-1.5 font-mono text-label tracking-[0.08em] text-primary-ink uppercase hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
        >
          <ArrowLeft aria-hidden="true" className="size-3.5 rtl:rotate-180" />
          {t("backToCategories")}
        </button>
        <h2 id="category-heading" className="font-heading text-[clamp(28px,4vw,48px)] leading-[0.95] font-medium tracking-tight normal-case">
          {name}
        </h2>
      </div>
      <span className="pb-1 font-mono text-label text-muted-foreground uppercase tabular-nums">{count}</span>
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
