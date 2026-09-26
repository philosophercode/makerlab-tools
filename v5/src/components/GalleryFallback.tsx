import { useTranslations } from "next-intl";
import { GalleryHero } from "./GalleryHero";

/**
 * The gallery while the catalogue loads (DESIGN.md §8.9: skeletons in the
 * content's shape, no spinner): the same hero, a filter-bar-high bar and six
 * card plates, pulsing only when motion is allowed.
 */
export function GalleryFallback() {
  const t = useTranslations("gallery");

  return (
    <main className="ui mx-auto w-full max-w-[1440px] px-4 pb-16 sm:px-8" aria-busy="true">
      <GalleryHero title={t("title")} facts={<span role="status">{t("loading")}</span>} />
      <div aria-hidden="true" className="mb-3 h-7 w-full max-w-72 bg-muted motion-safe:animate-pulse" />
      <section
        aria-label={t("toolGalleryLabel")}
        className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-5"
      >
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} aria-hidden="true" className="flex flex-col border border-border bg-card">
            <div className="aspect-[4/3] bg-muted motion-safe:animate-pulse" />
            <div className="flex flex-col gap-2 p-4">
              <div className="h-3.5 w-3/4 bg-muted" />
              <div className="h-2.5 w-1/2 bg-muted" />
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}
