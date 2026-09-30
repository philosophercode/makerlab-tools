import { renderSiteCard, SITE_CARD_ALT, SITE_CARD_SIZE } from "../lib/share/site-card";

/** X's `summary_large_image` card: the same picture as `opengraph-image.tsx`. */
export const alt = SITE_CARD_ALT;
export const size = SITE_CARD_SIZE;
export const contentType = "image/png";

export default function TwitterImage() {
  return renderSiteCard();
}
