"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { matchSorter } from "match-sorter";
import type { MakerLabTool } from "./catalog-types";
import { TechnicalFrame } from "./TechnicalFrame";
import { ToolCard } from "./ToolCard";

interface GalleryShellProps {
  tools: MakerLabTool[];
}

// Ranked, typo-tolerant search keys. match-sorter ranks earlier keys above
// later ones when match quality ties, so key order doubles as relevance
// weight: name first, then the structured metadata (category / tags /
// materials), then the free-text description last.
const SEARCH_KEYS: ReadonlyArray<keyof MakerLabTool> = [
  "name",
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

type SortKey = "name" | "category" | "zone" | "trainingLevel";
type SortState = { key: SortKey; dir: "asc" | "desc" };

// Table columns, in render order. `key` drives sorting; `labelKey` is the i18n
// header string.
const TABLE_COLUMNS: ReadonlyArray<{ key: SortKey; labelKey: string }> = [
  { key: "name", labelKey: "columnTool" },
  { key: "category", labelKey: "columnCategory" },
  { key: "zone", labelKey: "columnZone" },
  { key: "trainingLevel", labelKey: "columnTraining" },
];

// The catalog stores materials as a flat list with no type, so the grouping
// for the Materials dropdown is defined here. Matching is case-insensitive;
// anything not listed falls into "Other". Order here is the display order.
const MATERIAL_GROUPS: ReadonlyArray<{ label: string; values: string[] }> = [
  {
    label: "Plastics & Polymers",
    values: ["ABS", "Acrylic", "Composite", "Nylon", "PETG", "PLA", "Plastic", "Polycarbonate", "PVC", "Resin", "TPU", "Vinyl"],
  },
  { label: "Wood", values: ["Hardwood", "Softwood", "Plywood", "MDF", "Veneer", "Laminate", "Wood"] },
  { label: "Metal", values: ["Aluminum", "Brass", "Copper", "Steel"] },
  { label: "Other", values: ["Cardboard", "Ceramic", "Fabric", "Foam", "Glass", "Leather", "Paper", "Rubber"] },
];

const OTHER_GROUP_LABEL = "Other";

export function GalleryShell({ tools }: GalleryShellProps) {
  const t = useTranslations("gallery");
  const [query, setQuery] = useState("");
  // Category and materials are multi-select facets (OR within each facet);
  // location stays single-select.
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedMaterials, setSelectedMaterials] = useState<string[]>([]);
  const [location, setLocation] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [sort, setSort] = useState<SortState | null>(null);
  // The table is a dense desktop view; on phones it degrades to an oversized
  // card stack, so we force the grid (and hide the toggle) below this width.
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 860px)");
    const update = () => setIsNarrow(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  const effectiveViewMode = isNarrow ? "grid" : viewMode;

  const categories = useMemo(
    () => Array.from(new Set(tools.map((tool) => tool.category))).sort(),
    [tools]
  );

  // Facet options are derived from the loaded catalog, mirroring `categories`.
  const materials = useMemo(
    () => Array.from(new Set(tools.flatMap((tool) => tool.materials))).sort(),
    [tools]
  );

  const locations = useMemo(
    () => Array.from(new Set(tools.map((tool) => tool.location).filter(Boolean))).sort(),
    [tools]
  );

  // Bucket the catalog's materials into the MATERIAL_GROUPS taxonomy for the
  // grouped dropdown. Unknown values land in "Other"; empty groups are dropped.
  const materialGroups = useMemo(() => {
    const labelByValue = new Map<string, string>();
    MATERIAL_GROUPS.forEach((group) =>
      group.values.forEach((value) => labelByValue.set(value.toLowerCase(), group.label))
    );

    const itemsByLabel = new Map<string, string[]>();
    materials.forEach((material) => {
      const label = labelByValue.get(material.toLowerCase()) ?? OTHER_GROUP_LABEL;
      const bucket = itemsByLabel.get(label) ?? [];
      bucket.push(material);
      itemsByLabel.set(label, bucket);
    });

    return MATERIAL_GROUPS.map((group) => ({
      label: group.label,
      items: itemsByLabel.get(group.label) ?? [],
    })).filter((group) => group.items.length > 0);
  }, [materials]);

  const filteredTools = useMemo(() => {
    // Apply facet filters first. Within a multi-select facet the values OR
    // together; the facets then AND across dimensions.
    const faceted = tools.filter((tool) => {
      const matchesCategory =
        selectedCategories.length === 0 || selectedCategories.includes(tool.category);
      const matchesMaterial =
        selectedMaterials.length === 0 ||
        selectedMaterials.some((value) => tool.materials.includes(value));
      const matchesLocation = !location || tool.location === location;

      return matchesCategory && matchesMaterial && matchesLocation;
    });

    const normalizedQuery = query.trim();

    // Empty query preserves the catalog's existing order; a query applies a
    // fuzzy, ranked match across the weighted keys (typo tolerant).
    const searched = normalizedQuery
      ? matchSorter(faceted, normalizedQuery, { keys: SEARCH_KEYS.slice() })
      : faceted;

    // An explicit column sort overrides both catalog order and search ranking.
    if (!sort) {
      return searched;
    }

    return [...searched].sort((a, b) => {
      const left = String(a[sort.key] ?? "").toLowerCase();
      const right = String(b[sort.key] ?? "").toLowerCase();
      const comparison = left.localeCompare(right);
      return sort.dir === "asc" ? comparison : -comparison;
    });
  }, [location, query, selectedCategories, selectedMaterials, sort, tools]);

  const activeFilterCount =
    selectedCategories.length + selectedMaterials.length + (location ? 1 : 0);

  function toggleCategory(value: string) {
    setSelectedCategories((prev) =>
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]
    );
  }

  function toggleMaterial(value: string) {
    setSelectedMaterials((prev) =>
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]
    );
  }

  // Clicking a type heading selects every material in that group, or clears
  // them all if they're already selected.
  function toggleMaterialGroup(items: string[], allSelected: boolean) {
    setSelectedMaterials((prev) => {
      if (allSelected) {
        const toRemove = new Set(items);
        return prev.filter((item) => !toRemove.has(item));
      }
      return Array.from(new Set([...prev, ...items]));
    });
  }

  function clearFilters() {
    setSelectedCategories([]);
    setSelectedMaterials([]);
    setLocation(null);
  }

  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev && prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" }
    );
  }

  return (
    <main className="page-shell">
      <section className="gallery-header" aria-labelledby="gallery-title">
        <div className="title-row">
          <span className="target-glyph" aria-hidden="true">
            +
          </span>
          <h1 id="gallery-title">{t("title")}</h1>
        </div>

        <TechnicalFrame className="filter-console">
          <label className="search-row">
            <span>&gt;</span>
            <input
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchAria")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          <div className="filter-toolbar">
            <button
              className={filtersOpen || activeFilterCount > 0 ? "filter-toggle is-active" : "filter-toggle"}
              type="button"
              aria-expanded={filtersOpen}
              aria-controls="gallery-filter-controls"
              onClick={() => setFiltersOpen((open) => !open)}
            >
              Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
            </button>

            <div className="view-toggle" aria-label={t("viewModeLabel")}>
              <button
                className={viewMode === "grid" ? "is-active" : ""}
                type="button"
                onClick={() => setViewMode("grid")}
              >
                {t("grid")}
              </button>
              <button
                className={viewMode === "table" ? "is-active" : ""}
                type="button"
                onClick={() => setViewMode("table")}
              >
                {t("table")}
              </button>
            </div>
          </div>

          <div className={filtersOpen ? "filter-row is-open" : "filter-row"} id="gallery-filter-controls">
            <div className="filter-controls">
              <div className="filter-group filter-chip-group" role="group" aria-label={t("category")}>
                <span>{t("category")}</span>
                <div className="filter-chip-options">
                  {categories.map((categoryName) => {
                    const active = selectedCategories.includes(categoryName);
                    return (
                      <button
                        key={categoryName}
                        type="button"
                        className={active ? "filter-chip is-active" : "filter-chip"}
                        aria-pressed={active}
                        onClick={() => toggleCategory(categoryName)}
                      >
                        {categoryName}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="filter-group filter-dropdown-group" role="group" aria-label={t("materials")}>
                <span>{t("materials")}</span>
                <button
                  type="button"
                  className={
                    materialsOpen || selectedMaterials.length > 0
                      ? "filter-dropdown-toggle is-active"
                      : "filter-dropdown-toggle"
                  }
                  aria-expanded={materialsOpen}
                  onClick={() => setMaterialsOpen((open) => !open)}
                >
                  <span>
                    {selectedMaterials.length > 0 ? `${selectedMaterials.length} selected` : "All materials"}
                  </span>
                  <span className="filter-dropdown-caret" aria-hidden="true">
                    {materialsOpen ? "▲" : "▼"}
                  </span>
                </button>

                {materialsOpen ? (
                  <div className="filter-dropdown-panel">
                    {materialGroups.map((group) => {
                      const allSelected = group.items.every((value) => selectedMaterials.includes(value));
                      return (
                        <div className="filter-material-group" key={group.label}>
                          <button
                            type="button"
                            className="filter-material-group-heading"
                            aria-pressed={allSelected}
                            onClick={() => toggleMaterialGroup(group.items, allSelected)}
                          >
                            {group.label}
                          </button>
                          <div className="filter-chip-options">
                            {group.items.map((materialName) => {
                              const active = selectedMaterials.includes(materialName);
                              return (
                                <button
                                  key={materialName}
                                  type="button"
                                  className={active ? "filter-chip is-active" : "filter-chip"}
                                  aria-pressed={active}
                                  onClick={() => toggleMaterial(materialName)}
                                >
                                  {materialName}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>

              <label className="filter-group filter-select-group">
                <span>{t("location")}</span>
                <select value={location ?? ""} onChange={(event) => setLocation(event.target.value || null)}>
                  <option value="">All</option>
                  {locations.map((locationName) => (
                    <option key={locationName} value={locationName}>
                      {locationName}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="filter-actions">
              {activeFilterCount > 0 ? (
                <button className="filter-clear" type="button" onClick={clearFilters}>
                  Clear {activeFilterCount}
                </button>
              ) : null}
            </div>
          </div>
        </TechnicalFrame>
      </section>

      <section className={effectiveViewMode === "grid" ? "tool-grid" : "tool-table"} aria-label={t("toolGalleryLabel")}>
        {filteredTools.length > 0 ? (
          effectiveViewMode === "grid" ? (
            filteredTools.map((tool) => <ToolCard key={tool.id} tool={tool} />)
          ) : (
            <>
              <div className="tool-table-row tool-table-head" role="row">
                {TABLE_COLUMNS.map((column) => {
                  const active = sort?.key === column.key;
                  return (
                    <button
                      key={column.key}
                      type="button"
                      className={active ? "tool-table-sort is-active" : "tool-table-sort"}
                      aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"}
                      onClick={() => toggleSort(column.key)}
                    >
                      <span>{t(column.labelKey)}</span>
                      <span className="sort-indicator" aria-hidden="true">
                        {active ? (sort!.dir === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  );
                })}
              </div>
              {filteredTools.map((tool) => (
                <a className="tool-table-row" href={`/tools/${tool.slug}`} key={tool.id}>
                  <span className="tool-table-name">
                    <span className="tool-table-thumb" aria-hidden="true">
                      <Image src={tool.imageSrc} alt="" fill sizes="40px" style={{ objectFit: "contain" }} unoptimized />
                    </span>
                    <span>{tool.name}</span>
                  </span>
                  <span data-label={t("columnCategory")}>{tool.category}</span>
                  <span data-label={t("columnZone")}>{tool.zone}</span>
                  <span data-label={t("columnTraining")}>{tool.trainingLevel}</span>
                </a>
              ))}
            </>
          )
        ) : (
          <p className="empty-state">{t("empty")}</p>
        )}
      </section>
    </main>
  );
}
