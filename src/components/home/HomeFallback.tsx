import { useTranslations } from "next-intl";
import { HomeWordmark } from "./HomeWordmark";

/**
 * The home page while the catalogue loads (DESIGN.md §8.9: skeletons in the
 * content's shape, no spinner): the wordmark, a search-box-high bar, the
 * title and four tile plates, pulsing only when motion is allowed. The same
 * spacing as `HomeShell`, so nothing jumps when it arrives.
 */
export function HomeFallback() {
  const t = useTranslations("gallery");
  return (
    <main className="ui mx-auto w-full max-w-[1440px] px-4 pb-16 sm:px-8" aria-busy="true">
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-8 pt-12 pb-14 sm:gap-10 sm:pt-20 sm:pb-20 lg:pt-24">
        <HomeWordmark />
        <div aria-hidden="true" className="h-14 w-full border border-border bg-card sm:h-16" />
      </div>
      <div className="mb-4 flex items-end justify-between border-b border-rule pb-3">
        <h1 className="font-heading text-[clamp(36px,5vw,64px)] leading-[0.92] font-medium tracking-tight normal-case">{t("title")}</h1>
        <span role="status" className="pb-1 font-mono text-label text-muted-foreground uppercase">
          {t("loading")}
        </span>
      </div>
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
    </main>
  );
}
