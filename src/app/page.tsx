import { Suspense } from "react";
import { HomeFallback } from "../components/home/HomeFallback";
import { HomeShell } from "../components/home/HomeShell";
import { toGalleryTool } from "../components/catalog-types";
import { getCatalogTools, getCategoryOrder } from "../lib/catalog";

/**
 * The home page is the tool list (student home spec 2026-10-07, amendment
 * "One page: the list at rest"): "MakerLAB AI", the search, and every tool
 * grouped by category in the lab's order, with the list's filters; typing
 * swaps the groups for the matches. `/tools` redirects here
 * (`next.config.ts`).
 */
export default function HomePage() {
  return (
    <Suspense fallback={<HomeFallback />}>
      <HomeData />
    </Suspense>
  );
}

async function HomeData() {
  const [tools, categoryOrder] = await Promise.all([getCatalogTools(), getCategoryOrder()]);
  // Only what the list reads travels to the browser (`toGalleryTool`).
  return <HomeShell tools={tools.map(toGalleryTool)} categoryOrder={categoryOrder} />;
}
