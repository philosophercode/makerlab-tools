import { TechnicalFrame } from "./TechnicalFrame";

export function GalleryFallback() {
  return (
    <main className="page-shell" aria-busy="true">
      <section className="gallery-header" aria-labelledby="gallery-title">
        <div className="title-row">
          <span className="target-glyph" aria-hidden="true">
            +
          </span>
          <h1 id="gallery-title">TOOLS // MACHINES</h1>
        </div>

        <TechnicalFrame className="filter-console">
          <p className="loading-line">&gt; loading inventory<span className="loading-dots" aria-hidden="true" /></p>
        </TechnicalFrame>
      </section>

      <section className="tool-grid" aria-label="Tool gallery loading">
        {Array.from({ length: 6 }).map((_, index) => (
          <TechnicalFrame key={index} className="tool-card-skeleton">
            <div className="skeleton-block skeleton-image" />
            <div className="skeleton-block skeleton-line" />
            <div className="skeleton-block skeleton-line skeleton-line-short" />
          </TechnicalFrame>
        ))}
      </section>
    </main>
  );
}
