import type { Metadata } from "next";
import en from "../../../messages/en.json";
import { siteConfig } from "../../lib/site-config";
import { OG_IMAGE, PRODUCT_HREF, QUICK_START_HREF } from "./product-content";

/**
 * Title, description and Open Graph card for the two product pages. In
 * English, like every page's metadata here (`/about`): metadata is resolved
 * outside the page's locale and a link preview is read before anyone picks a
 * language.
 */
export function productMetadata(page: "product" | "quickStart"): Metadata {
  const words = page === "product" ? en.product : en.product.quickStartPage;
  const title = words.metaTitle.replace("{site}", siteConfig.name);
  const description = words.metaDescription;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      url: page === "product" ? PRODUCT_HREF : QUICK_START_HREF,
      siteName: siteConfig.name,
      images: [{ url: OG_IMAGE.url, width: OG_IMAGE.width, height: OG_IMAGE.height, alt: en.product.heroShotAlt }],
    },
    twitter: { card: "summary_large_image", title, description, images: [OG_IMAGE.url] },
  };
}
