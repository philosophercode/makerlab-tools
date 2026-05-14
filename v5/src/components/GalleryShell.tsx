"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import type { MakerLabTool } from "./catalog-types";
import { TechnicalFrame } from "./TechnicalFrame";
import { ToolCard } from "./ToolCard";

interface GalleryShellProps {
  tools: MakerLabTool[];
}

export function GalleryShell({ tools }: GalleryShellProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [training, setTraining] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");

  const categories = useMemo(
    () => Array.from(new Set(tools.map((tool) => tool.category))).sort(),
    [tools]
  );

  const filteredTools = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return tools.filter((tool) => {
      const searchable = [
        tool.name,
        tool.category,
        tool.categorySub,
        tool.location,
        tool.zone,
        tool.trainingLevel,
        tool.description,
        ...tool.ppe,
        ...tool.materials,
        ...tool.tags,
      ]
        .join(" ")
        .toLowerCase();

      const matchesQuery = !normalizedQuery || searchable.includes(normalizedQuery);
      const matchesCategory = !category || tool.category === category;
      const matchesTraining = !training || tool.trainingLevel === training;

      return matchesQuery && matchesCategory && matchesTraining;
    });
  }, [category, query, tools, training]);

  return (
    <main className="page-shell">
      <section className="gallery-header" aria-labelledby="gallery-title">
        <div className="title-row">
          <span className="target-glyph" aria-hidden="true">
            +
          </span>
          <h1 id="gallery-title">TOOLS // MACHINES</h1>
        </div>

        <TechnicalFrame className="filter-console">
          <label className="search-row">
            <span>&gt;</span>
            <input
              placeholder="search inventory..."
              aria-label="Search inventory"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          <div className="filter-row">
            <div className="filter-group">
              <span>CATEGORY:</span>
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
              <span>TRAINING:</span>
              <div className="chip-row">
                {["Beginner", "Intermediate", "Advanced"].map((level) => (
                  <button
                    className={training === level ? "chip chip-active" : "chip"}
                    key={level}
                    type="button"
                    aria-pressed={training === level}
                    onClick={() =>
                      setTraining((selected) => (selected === level ? null : level))
                    }
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>

            <div className="view-toggle" aria-label="View mode">
              <button
                className={viewMode === "grid" ? "is-active" : ""}
                type="button"
                onClick={() => setViewMode("grid")}
              >
                [ GRID ]
              </button>
              <button
                className={viewMode === "table" ? "is-active" : ""}
                type="button"
                onClick={() => setViewMode("table")}
              >
                [ TABLE ]
              </button>
            </div>
          </div>
        </TechnicalFrame>
      </section>

      <section className={viewMode === "grid" ? "tool-grid" : "tool-table"} aria-label="Tool gallery">
        {filteredTools.length > 0 ? (
          viewMode === "grid" ? (
            filteredTools.map((tool) => <ToolCard key={tool.id} tool={tool} />)
          ) : (
            <>
              <div className="tool-table-row tool-table-head" role="row" aria-hidden="true">
                <span>Tool</span>
                <span>Category</span>
                <span>Zone</span>
                <span>Training</span>
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
          <p className="empty-state">No matching tools found.</p>
        )}
      </section>
    </main>
  );
}
