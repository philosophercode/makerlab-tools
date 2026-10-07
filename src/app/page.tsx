import { Suspense } from "react";
import { HomeFallback } from "../components/home/HomeFallback";
import { HomeShell } from "../components/home/HomeShell";
import { toHomeTool } from "../components/home/home-tools";
import { getCatalogTools, getCategoryOrder } from "../lib/catalog";

/**
 * The student home (student home spec 2026-10-07): the big wordmark, the
 * smart search and the categories. The full list with its filters is
 * `/tools`.
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
  // Only what the search and the tiles read travels to the browser (`toHomeTool`).
  return <HomeShell tools={tools.map(toHomeTool)} categoryOrder={categoryOrder} />;
}
