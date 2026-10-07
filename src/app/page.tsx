import { Suspense } from "react";
import { DemoSignupCallout } from "../components/demo/DemoSignupCallout";
import { HomeFallback } from "../components/home/HomeFallback";
import { HomeShell } from "../components/home/HomeShell";
import { toHomeTool } from "../components/home/home-tools";
import { OnShiftNow } from "../components/on-shift/OnShiftNow";
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
  // Who is on shift is its own dynamic hole (on-shift spec 2026-10-07), so
  // the home itself stays cached.
  return (
    <HomeShell
      tools={tools.map(toHomeTool)}
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
