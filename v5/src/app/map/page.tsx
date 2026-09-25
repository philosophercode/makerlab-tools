import { Suspense } from "react";
import { MapExplorer } from "../../components/map/MapExplorer";
import { getCatalogTools } from "../../lib/catalog";
import { STUDIO_101 } from "../../lib/map/studio-101";
import { siteConfig } from "../../lib/site-config";

/**
 * `/map` — the lab's floor plan with every published tool placed on it
 * (floor map spec §6.3). The catalogue read is the gallery's own cached one;
 * the explorer reads `?highlight=` and `?q=` itself, inside this boundary, so
 * the shell stays static under `cacheComponents`.
 */

export const metadata = {
  title: `Floor map — ${siteConfig.name}`,
};

export default function MapPage() {
  return (
    <Suspense fallback={null}>
      <MapData />
    </Suspense>
  );
}

async function MapData() {
  const tools = await getCatalogTools();
  return <MapExplorer plan={STUDIO_101} tools={tools} />;
}
