"use client";

import { useTranslations } from "next-intl";
import { SkeletonBlock, SkeletonHeader } from "./Skeleton";

/**
 * What a public page shows between a tap and its content (performance plan,
 * quick win 5; every `loading.tsx` outside `app/admin`). Public pages had no
 * boundary below the root, whose fallback is empty, so tapping a tool card
 * changed nothing on screen for 210–310 ms on a phone. The prefetch now
 * carries this, so the tap paints it at once.
 *
 * - `tool` — a tool page: breadcrumbs, the image and the title beside it,
 *   then two columns of spec rows.
 * - `cards` — a grid of project cards.
 * - `page` — a reading column: a header and paragraphs.
 *
 * A client component so the fallback stays static (see `AdminPageLoading`).
 */
export function PublicPageLoading({ shape }: { shape: "tool" | "cards" | "page" }) {
  const t = useTranslations("ui");
  return (
    <main
      role="status"
      aria-busy="true"
      data-slot="page-loading"
      className={
        shape === "tool"
          ? "ui mx-auto flex w-full max-w-[1200px] min-w-0 flex-col gap-8 px-4 pt-5 pb-16 sm:px-8"
          : `ui mx-auto flex w-full min-w-0 flex-col gap-6 px-4 pt-8 pb-16 sm:px-8 ${shape === "cards" ? "max-w-[1440px]" : "max-w-[944px]"}`
      }
    >
      <span className="sr-only">{t("loading")}</span>
      {shape === "tool" ? (
        <>
          <SkeletonBlock className="h-3 w-48" />
          <div className="grid min-w-0 gap-5 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] md:gap-8">
            <SkeletonBlock className="aspect-[4/3] w-full max-w-[12rem] sm:max-w-none" />
            <div className="flex min-w-0 flex-col gap-3">
              <SkeletonBlock className="h-10 w-3/4" />
              <SkeletonBlock className="h-3 w-1/3" />
              <SkeletonBlock className="h-4 w-full max-w-[40rem]" />
              <SkeletonBlock className="h-4 w-5/6 max-w-[36rem]" />
            </div>
          </div>
          <div className="grid min-w-0 gap-8 lg:grid-cols-2 lg:gap-10">
            {[0, 1].map((column) => (
              <div key={column} className="flex flex-col gap-3">
                <SkeletonBlock className="h-4 w-32" />
                {Array.from({ length: 5 }, (_, row) => (
                  <SkeletonBlock key={row} className="h-5 w-full" />
                ))}
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <SkeletonHeader />
          {shape === "cards" ? (
            <div aria-hidden="true" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }, (_, n) => (
                <SkeletonBlock key={n} className="aspect-[4/3] w-full" />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 6 }, (_, n) => (
                <SkeletonBlock key={n} className={n % 3 === 2 ? "h-4 w-2/3" : "h-4 w-full"} />
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}
