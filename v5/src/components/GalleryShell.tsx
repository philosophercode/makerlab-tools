"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { matchSorter } from "match-sorter";
import type { MakerLabTool } from "./catalog-types";
import { TechnicalFrame } from "./TechnicalFrame";
import { ToolCard } from "./ToolCard";

interface GalleryShellProps {
  tools: MakerLabTool[];
}

const TRAINING_LEVELS = [
  { value: "Beginner", key: "trainingBeginner" },
  { value: "Intermediate", key: "trainingIntermediate" },
  { value: "Advanced", key: "trainingAdvanced" },
] as const;

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

export function GalleryShell({ tools }: GalleryShellProps) {
  const t = useTranslations("gallery");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [training, setTraining] = useState<string | null>(null);
  const [material, setMaterial] = useState<string | null>(null);
  const [location, setLocation] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [filtersOpen, setFiltersOpen] = useState(false);

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

  const filteredTools = useMemo(() => {
    // Apply facet filters first; each dimension is single-select and they
    // combine with AND across dimensions.
    const faceted = tools.filter((tool) => {
      const matchesCategory = !category || tool.category === category;
      const matchesTraining = !training || tool.trainingLevel === training;
      const matchesMaterial = !material || tool.materials.includes(material);
      const matchesLocation = !location || tool.location === location;

      return matchesCategory && matchesTraining && matchesMaterial && matchesLocation;
    });

    const normalizedQuery = query.trim();

    // Empty query preserves the catalog's existing order (show all).
    if (!normalizedQuery) {
      return faceted;
    }

    // Fuzzy, ranked match across the weighted keys (typo tolerant).
    return matchSorter(faceted, normalizedQuery, { keys: SEARCH_KEYS.slice() });
  }, [category, location, material, query, tools, training]);

  const activeFilterCount = [category, training, material, location].filter(Boolean).length;

  function clearFilters() {
    setCategory(null);
    setTraining(null);
    setMaterial(null);
    setLocation(null);
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

          <div className={filtersOpen ? "filter-row is-open" : "filter-row"}>
            <div className="filter-controls">
              <label className="filter-group filter-select-group">
                <span>{t("category")}</span>
                <select value={category ?? ""} onChange={(event) => setCategory(event.target.value || null)}>
                  <option value="">All</option>
                  {categories.map((categoryName) => (
                    <option key={categoryName} value={categoryName}>
                      {categoryName}
                    </option>
                  ))}
                </select>
              </label>

              <label className="filter-group filter-select-group">
                <span>{t("training")}</span>
                <select value={training ?? ""} onChange={(event) => setTraining(event.target.value || null)}>
                  <option value="">All</option>
                  {TRAINING_LEVELS.map((level) => (
                    <option key={level.value} value={level.value}>
                      {t(level.key)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="filter-group filter-select-group">
                <span>{t("materials")}</span>
                <select value={material ?? ""} onChange={(event) => setMaterial(event.target.value || null)}>
                  <option value="">All</option>
                  {materials.map((materialName) => (
                    <option key={materialName} value={materialName}>
                      {materialName}
                    </option>
                  ))}
                </select>
              </label>

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

      <section className={viewMode === "grid" ? "tool-grid" : "tool-table"} aria-label={t("toolGalleryLabel")}>
        {filteredTools.length > 0 ? (
          viewMode === "grid" ? (
            filteredTools.map((tool) => <ToolCard key={tool.id} tool={tool} />)
          ) : (
            <>
              <div className="tool-table-row tool-table-head" role="row" aria-hidden="true">
                <span>{t("columnTool")}</span>
                <span>{t("columnCategory")}</span>
                <span>{t("columnZone")}</span>
                <span>{t("columnTraining")}</span>
              </div>
              {filteredTools.map((tool) => (
                <a className="tool-table-row" href={`/tools/${tool.slug}`} key={tool.id}>
                  <span className="tool-table-name">
                    <span className="tool-table-thumb" aria-hidden="true">
                      <Image src={tool.imageSrc} alt="" fill sizes="40px" style={{ objectFit: "contain" }} unoptimized />
                    </span>
                    <span>{tool.name}</span>
                  </span>
                  <span>{tool.category}</span>
                  <span>{tool.zone}</span>
                  <span>{tool.trainingLevel}</span>
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
