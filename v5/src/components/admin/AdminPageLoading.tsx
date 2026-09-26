"use client";

import { useTranslations } from "next-intl";
import { EmptyState } from "../system/EmptyState";

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
 * the navigation commits at once with this line and the page streams into it
 * (DESIGN.md "Admin navigation never waits on a hole";
 * `e2e/admin-client-navigation.spec.ts`).
 *
 * A client component so the fallback is static: `getTranslations` reads the
 * locale cookie, which would make the fallback itself a dynamic hole.
 */
export function AdminPageLoading() {
  const t = useTranslations("admin");
  return <EmptyState>{t("loading")}</EmptyState>;
}
