import { useTranslations } from "next-intl";
import { GalleryFallback } from "../GalleryFallback";
import { LandingLockup } from "./LandingLockup";

/**
 * The home page while the catalogue loads (DESIGN.md §8.9: skeletons in the
 * content's shape, no spinner): "MakerLAB AI", a search-box-high plate, then
 * the list's skeleton (`GalleryFallback`). The same spacing as `HomeShell`,
 * so nothing jumps when it arrives.
 */
export function HomeFallback() {
  const t = useTranslations("gallery.home");
  return (
    <main className="ui mx-auto w-full max-w-[1440px] px-4 pb-16 sm:px-8">
      <section
        aria-label={t("searchSection")}
        className="mx-auto flex w-full max-w-3xl flex-col items-center gap-5 pt-8 pb-6 sm:gap-7 sm:pt-12 sm:pb-8 lg:pt-14"
      >
        <LandingLockup observe={false} />
        <div aria-hidden="true" className="h-14 w-full border border-foreground/70 bg-card sm:h-16" />
      </section>
      <GalleryFallback />
    </main>
  );
}
