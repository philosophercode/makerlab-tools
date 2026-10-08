import { useTranslations } from "next-intl";

/**
 * The home page's content while the catalogue loads (DESIGN.md §8.9:
 * skeletons in the content's shape, no spinner): four category-tile plates,
 * 2 / 3 / 4 across like the tiles, pulsing only when motion is allowed. The
 * home page's skeleton (`HomeFallback`) puts it under the search.
 */
export function GalleryFallback() {
  const t = useTranslations("gallery");

  return (
    <div aria-busy="true" data-slot="tool-list-fallback">
      <p role="status" className="sr-only">
        {t("loading")}
      </p>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} aria-hidden="true" className="flex flex-col border border-border bg-card">
            <div className="aspect-[4/3] bg-muted motion-safe:animate-pulse" />
            <div className="flex flex-col gap-2 p-5">
              <div className="h-4 w-3/4 bg-muted" />
              <div className="h-2.5 w-1/2 bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
