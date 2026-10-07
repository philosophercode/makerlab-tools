import { Suspense } from "react";
import { GalleryFallback } from "../../components/GalleryFallback";
import { GalleryShell } from "../../components/GalleryShell";
import { getCatalogTools } from "../../lib/catalog";
import { toGalleryTool } from "../../components/catalog-types";

export const metadata = {
  title: "All tools",
};

/**
 * `/tools`: every tool in one list, with the search, the filters, the
 * grouping, the sort and the grid or table view (student home spec
 * 2026-10-07 §5). It was the home page until the home became the categories;
 * an old `/?category=…` link is redirected here (`next.config.ts`).
 */
export default function AllToolsPage() {
  return (
    <Suspense fallback={<GalleryFallback />}>
      <GalleryData />
    </Suspense>
  );
}

async function GalleryData() {
  const tools = await getCatalogTools();
  // Only what the gallery reads travels to the browser (`toGalleryTool`).
  return <GalleryShell tools={tools.map(toGalleryTool)} />;
}
