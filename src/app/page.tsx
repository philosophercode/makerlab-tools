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
  const tools = await getCatalogTools();
  // Only what the gallery reads travels to the browser (`toGalleryTool`).
  return <GalleryShell tools={tools.map(toGalleryTool)} />;
}
