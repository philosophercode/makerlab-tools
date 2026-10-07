import { Suspense } from "react";
import { DemoSignupCallout } from "../../components/demo/DemoSignupCallout";
import { GalleryFallback } from "../../components/GalleryFallback";
import { GalleryShell } from "../../components/GalleryShell";
import { OnShiftNow } from "../../components/on-shift/OnShiftNow";
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
    <>
      {/* The demo pass's way in, above the full list (demo pass spec
          2026-10-07 §6), as it sat above the gallery on the old home page. */}
      <DemoSignupCallout />
      <Suspense fallback={<GalleryFallback />}>
        <GalleryData />
      </Suspense>
    </>
  );
}

async function GalleryData() {
  const tools = await getCatalogTools();
  // Only what the gallery reads travels to the browser (`toGalleryTool`).
  // Who is on shift is its own dynamic hole (on-shift spec 2026-10-07), so
  // the list itself stays cached.
  return (
    <GalleryShell
      tools={tools.map(toGalleryTool)}
      onShift={
        <Suspense fallback={null}>
          <OnShiftNow />
        </Suspense>
      }
    />
  );
}
