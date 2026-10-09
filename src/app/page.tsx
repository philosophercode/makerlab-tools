import { Suspense } from "react";
import { DemoSignupCallout } from "../components/demo/DemoSignupCallout";
import { HomeFallback } from "../components/home/HomeFallback";
import { HomeShell } from "../components/home/HomeShell";
import { OnShiftNow } from "../components/on-shift/OnShiftNow";
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
  // Who is on shift is its own dynamic hole (on-shift spec 2026-10-07), so
  // the page itself stays cached.
  return (
    <HomeShell
      tools={tools.map(toGalleryTool)}
      categoryOrder={categoryOrder}
      onShift={
        <Suspense fallback={null}>
          <OnShiftNow className="justify-center text-center" />
        </Suspense>
      }
      // The demo pass's way in (demo pass spec 2026-10-07 §6): one small line
      // under the search, above the categories. Nothing with DEMO_PASS=off.
      demoCallout={<DemoSignupCallout variant="inline" />}
    />
  );
}
