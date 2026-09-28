import { Suspense } from "react";
import { MapGate } from "../../components/map/MapGate";
import { siteConfig } from "../../lib/site-config";

/**
 * `/map` — the lab's floor plan with every published tool placed on it
 * (floor map spec §6.3), for signed-in people only (map access, PR #98).
 * The session read happens inside this boundary, in `MapGate`, so the shell
 * stays static under `cacheComponents` and holds no plan data; the explorer
 * reads `?highlight=` and `?q=` itself.
 */

export const metadata = {
  title: `Floor map — ${siteConfig.name}`,
};

export default function MapPage() {
  return (
    <Suspense fallback={null}>
      <MapGate />
    </Suspense>
  );
}
