"use client";

import { useTranslations } from "next-intl";
import { SkeletonBlock, SkeletonFilterBar, SkeletonHeader, SkeletonTable, SkeletonTiles } from "../system/Skeleton";

/** The shape of the page that is on its way. */
export type AdminLoadingShape = "tiles" | "table" | "detail" | "page";

/**
 * What an admin page shows between a click in the section bar and its data
 * (every `loading.tsx` under `app/admin`).
 *
 * **Why every admin segment has one.** Each admin page reads the request (the
 * identity, the locale) at its root, so the page's prefetched segment is a
 * static shell with an unfilled dynamic hole where the page should be. On a
 * client navigation the router renders that prefetched shell first; with no
 * Suspense boundary *inside* the new segment, the hole suspended the whole
 * navigation — the section bar's boundary was already on screen, so React
 * held the old page instead of showing a fallback — and in production that
 * transition was sometimes never retried: the click was answered, the data
 * arrived (200), and the new page never mounted until something else updated
 * the page. A `loading.tsx` gives each segment a fresh boundary of its own, so
 * the navigation commits at once with this and the page streams into it
 * (DESIGN.md "Admin navigation never waits on a hole";
 * `e2e/admin-client-navigation.spec.ts`).
 *
 * **Shaped like the page** (performance plan, "Page-shaped admin skeletons"):
 * the header, then the home's tiles, a list's filter bar and table, or a
 * record's sections — so the page replaces it without a jump, where a single
 * "Loading…" line in an empty area read as slow even when the server was
 * quick. The words are still there, once, for a screen reader.
 *
 * A client component so the fallback is static: `getTranslations` reads the
 * locale cookie, which would make the fallback itself a dynamic hole.
 */
export function AdminPageLoading({ shape = "table" }: { shape?: AdminLoadingShape }) {
  const t = useTranslations("admin");
  return (
    <div role="status" aria-busy="true" data-slot="admin-page-loading" data-shape={shape} className="ui flex flex-col gap-6">
      <span className="sr-only">{t("loading")}</span>
      <SkeletonHeader />
      {shape === "tiles" ? <SkeletonTiles /> : null}
      {shape === "table" ? (
        <>
          <SkeletonFilterBar />
          <SkeletonTable />
        </>
      ) : null}
      {shape === "detail" || shape === "page" ? (
        <div aria-hidden="true" className={shape === "detail" ? "grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" : "flex flex-col gap-6"}>
          {Array.from({ length: shape === "detail" ? 2 : 1 }, (_, column) => (
            <div key={column} className="flex flex-col gap-3">
              {Array.from({ length: 6 }, (_, row) => (
                <SkeletonBlock key={row} className={row === 0 ? "h-5 w-40" : "h-10 w-full"} />
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
