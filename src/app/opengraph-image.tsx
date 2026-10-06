import { renderSiteCard, SITE_CARD_ALT, SITE_CARD_SIZE } from "../lib/share/site-card";

/**
 * The site's link preview (WhatsApp, iMessage, Slack, LinkedIn): the lab's
 * official logo, the name and the tagline. Every page without its own image inherits it; a
 * tool or project page with a photo shows the photo instead
 * (`lib/share/metadata.ts`). Prerendered at build.
 */
export const alt = SITE_CARD_ALT;
export const size = SITE_CARD_SIZE;
export const contentType = "image/png";

export default function OpenGraphImage() {
  return renderSiteCard();
}
