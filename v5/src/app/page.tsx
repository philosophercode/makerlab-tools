import { Suspense } from "react";
import { GalleryFallback } from "../components/GalleryFallback";
import { GalleryShell } from "../components/GalleryShell";
import { getCatalogTools } from "../lib/catalog";
import { toGalleryTool } from "../components/catalog-types";

export default function GalleryPage() {
  return (
    <Suspense fallback={<GalleryFallback />}>
      <GalleryData />
    </Suspense>
  );
}

async function GalleryData() {
  // Only what the gallery reads crosses to the browser (performance plan, quick win 11).
  const tools = (await getCatalogTools()).map(toGalleryTool);
  return <GalleryShell tools={tools} />;
}
