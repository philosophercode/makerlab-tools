"use client";

import { useEffect, useRef } from "react";
import { siteConfig } from "../../lib/site-config";
import { setLandingLockupOnScreen } from "./landing-lockup-store";

/**
 * "MakerLAB AI" above the home page's search, at display size (student home
 * spec, amendment "One page: the list at rest"; identity spec amendment "The
 * landing lockup"): the header's lockup drawn large — the official lettering
 * as a mask in the text colour (`.brand-wordmark`), then "AI" in the accent
 * (`.brand-ai`) — sized by `--wordmark-height` on `.landing-lockup`.
 *
 * It is the page's `h1`. While it is on screen the header hides its own
 * lockup (`HeaderBrand`), so the logo shows once; it reports that through
 * `landing-lockup-store`. The skeleton draws it too (`observe={false}`), so
 * nothing moves when the list arrives.
 */
export function LandingLockup({ observe = true }: { observe?: boolean }) {
  const ref = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!observe || !element || typeof IntersectionObserver === "undefined") return;
    // Off screen once it has passed under the sticky bar, not the window's top edge.
    const bar = document.querySelector<HTMLElement>(".top-nav");
    const sticks = bar ? getComputedStyle(bar).position === "sticky" : false;
    const top = sticks && bar ? bar.offsetHeight : 0;
    const observer = new IntersectionObserver(([entry]) => setLandingLockupOnScreen(entry.isIntersecting), {
      rootMargin: `-${top}px 0px 0px 0px`,
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      // Leaving the page: the next visit to `/` starts with it in view.
      setLandingLockupOnScreen(true);
    };
  }, [observe]);

  const mask = `url(${siteConfig.wordmark})`;
  return (
    <h1 ref={ref} className="landing-lockup" data-slot="landing-lockup">
      <span aria-hidden="true" className="brand-wordmark" style={{ maskImage: mask, WebkitMaskImage: mask }} />
      <span aria-hidden="true" className="brand-ai">
        AI
      </span>
      <span className="sr-only">MakerLAB AI</span>
    </h1>
  );
}
