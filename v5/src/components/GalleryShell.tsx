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

          <div className="filter-row">
            <div className="filter-group">
              <span>{t("category")}</span>
              <div className="chip-row">
                {categories.map((categoryName) => (
                  <button
                    className={category === categoryName ? "chip chip-active" : "chip"}
                    key={categoryName}
                    type="button"
                    aria-pressed={category === categoryName}
                    onClick={() =>
                      setCategory((selected) => (selected === categoryName ? null : categoryName))
                    }
                  >
                    {categoryName}
                  </button>
                ))}
              </div>
            </div>

            <div className="filter-group">
              <span>{t("training")}</span>
              <div className="chip-row">
                {TRAINING_LEVELS.map((level) => (
                  <button
                    className={training === level.value ? "chip chip-active" : "chip"}
                    key={level.value}
                    type="button"
                    aria-pressed={training === level.value}
                    onClick={() =>
                      setTraining((selected) => (selected === level.value ? null : level.value))
                    }
                  >
                    {t(level.key)}
                  </button>
                ))}
              </div>
            </div>

            <div className="filter-group">
              <span>{t("materials")}</span>
              <div className="chip-row">
                {materials.map((materialName) => (
                  <button
                    className={material === materialName ? "chip chip-active" : "chip"}
                    key={materialName}
                    type="button"
                    aria-pressed={material === materialName}
                    onClick={() =>
                      setMaterial((selected) => (selected === materialName ? null : materialName))
                    }
                  >
                    {materialName}
                  </button>
                ))}
              </div>
            </div>

            <div className="filter-group">
              <span>{t("location")}</span>
              <div className="chip-row">
                {locations.map((locationName) => (
                  <button
                    className={location === locationName ? "chip chip-active" : "chip"}
                    key={locationName}
                    type="button"
                    aria-pressed={location === locationName}
                    onClick={() =>
                      setLocation((selected) => (selected === locationName ? null : locationName))
                    }
                  >
                    {locationName}
                  </button>
                ))}
              </div>
            </div>

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
                      <Image src={tool.imageSrc} alt="" fill sizes="40px" style={{ objectFit: "contain" }} />
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
