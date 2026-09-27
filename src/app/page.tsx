import { Suspense } from "react";
import { GalleryFallback } from "../components/GalleryFallback";
import { GalleryShell } from "../components/GalleryShell";
import { getCatalogTools } from "../lib/catalog";

export default function GalleryPage() {
  return (
    <Suspense fallback={<GalleryFallback />}>
      <GalleryData />
    </Suspense>
  );
}

async function GalleryData() {
  const tools = await getCatalogTools();
  return <GalleryShell tools={tools} />;
}
