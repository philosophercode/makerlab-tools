import { siteConfig } from "../../lib/site-config";

/**
 * The big striped MakerLAB wordmark at the top of the home page (owner
 * addendum 2026-10-07: in place of the "Start here" band, generous space, a
 * bigger wordmark and the search box). The same mark as the header's, drawn
 * the same way: a mask filled with the text colour, so it follows the theme.
 * At this size it uses the vector trace (`siteConfig.wordmarkLarge`); the
 * header keeps its PNG.
 *
 * Decoration: the header's link already names the site, and the page's
 * heading is "Tools".
 *
 * Unused since the student home spec's amendment "The logo once"
 * (2026-10-07): the logo appears once, in the header. Kept until its removal
 * is approved.
 */
export function HomeWordmark() {
  return (
    <span
      aria-hidden="true"
      data-slot="home-wordmark"
      className="home-wordmark"
      style={{ maskImage: `url(${siteConfig.wordmarkLarge})`, WebkitMaskImage: `url(${siteConfig.wordmarkLarge})` }}
    />
  );
}
