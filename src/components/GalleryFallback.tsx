import { useTranslations } from "next-intl";

/**
 * The tool list while the catalogue loads (DESIGN.md §8.9: skeletons in the
 * content's shape, no spinner): a chips-high bar, a filter-bar-high bar, a
 * section heading and five card plates, pulsing only when motion is allowed.
 * The home page's skeleton (`HomeFallback`) puts it under the search.
 */
export function GalleryFallback() {
  const t = useTranslations("gallery");

  return (
    <div aria-busy="true" data-slot="tool-list-fallback">
      <div aria-hidden="true" className="mb-2 h-8 w-full max-w-2xl bg-muted motion-safe:animate-pulse" />
      <div aria-hidden="true" className="mb-3 h-7 w-full max-w-72 bg-muted motion-safe:animate-pulse" />
      <p role="status" className="mb-3 border-b border-rule py-2 font-mono text-label tracking-[0.08em] text-muted-foreground uppercase">
        {t("loading")}
      </p>
      <section aria-label={t("toolGalleryLabel")} className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} aria-hidden="true" className="flex flex-col border border-border bg-card">
            <div className="aspect-[4/3] bg-muted motion-safe:animate-pulse" />
            <div className="flex flex-col gap-2 p-4">
              <div className="h-3.5 w-3/4 bg-muted" />
              <div className="h-2.5 w-1/2 bg-muted" />
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
