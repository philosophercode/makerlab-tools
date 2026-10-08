"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { siteConfig } from "../lib/site-config";
import { useLandingLockupOnScreen } from "./home/landing-lockup-store";

/**
 * The header's "MakerLAB AI" lockup (identity spec, amendment "The header
 * reads MakerLAB AI"): the wordmark (a mask, so it takes the theme's text
 * colour), then "AI" in the accent. The wordmark is decoration, so the link
 * is named in full.
 *
 * **On `/` it steps aside** while the page's own big lockup is on screen
 * (student home spec, amendment "One page: the list at rest"): the logo
 * shows once. It keeps its box, so the bar does not move between pages
 * (`e2e/header-stability.spec.ts`), and it stays a link a keyboard can reach —
 * it shows again when focused. Once the page's lockup has scrolled away under
 * the bar, the header's comes back. On every other page it is as it was.
 */
export function HeaderBrand() {
  const pathname = usePathname();
  const landingOnScreen = useLandingLockupOnScreen();
  const concealed = pathname === "/" && landingOnScreen;
  const mask = `url(${siteConfig.wordmark})`;
  return (
    <Link className="brand-lockup" href="/" aria-label="MakerLAB AI" data-concealed={concealed ? "" : undefined}>
      <span
        aria-hidden="true"
        data-slot="brand-wordmark"
        className="brand-wordmark"
        style={{ maskImage: mask, WebkitMaskImage: mask }}
      />
      <span className="brand-ai">AI</span>
    </Link>
  );
}
