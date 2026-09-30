"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { isKioskPath } from "./kiosk-path";

/**
 * The root layout's chrome — `GlobalChrome` and `DemoDataBanner` — drawn on
 * every page except the kiosk, which draws its own top bar and demo chip
 * (kiosk spec §3.1). A client boundary because the layout is prerendered and
 * cannot read the path itself; the children stay server components.
 */
export function SiteChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return isKioskPath(pathname) ? null : <>{children}</>;
}
