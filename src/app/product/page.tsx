import type { Metadata } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { CostTable } from "../../components/product/CostTable";
import { FeatureList } from "../../components/product/FeatureList";
import { PillarGrid } from "../../components/product/PillarGrid";
import { ProductHero } from "../../components/product/ProductHero";
import { ProductSection } from "../../components/product/ProductSection";
import { WalkthroughVideo } from "../../components/product/WalkthroughVideo";
import { productMetadata } from "./metadata";
import { QUICK_START_HREF, TRY_IT_HREF } from "./product-content";

export const metadata: Metadata = productMetadata("product");

const PRIVACY = ["signIn", "usage", "permissions", "safety"] as const;

/**
 * `/product` (identity spec amendment 2026-09-28 "Product page and quick
 * start"): the MakerLAB AI for someone deciding what it is worth —
 * the lab's director, a visitor — in the order a product page is read: what
 * it is and a way to try it, a 49-second video, the three things it helps
 * with, every feature with a real screenshot, what it costs to run, privacy
 * and safety, and who made it. Static: no request data, English underneath
 * every locale. Linked from the About page and the footer, not the main nav.
 */
export default function ProductPage() {
  const t = useTranslations("product");
  return (
    <main data-slot="product-page" className="ui mx-auto flex w-full max-w-[1264px] min-w-0 flex-col px-4 pb-20 sm:px-8">
      <ProductHero />

      <ProductSection id="product-video" title={t("videoHeading")} lede={t("videoLede")}>
        <WalkthroughVideo />
      </ProductSection>

      <ProductSection id="product-pillars" title={t("pillarsHeading")} lede={t("pillarsLede")}>
        <PillarGrid />
      </ProductSection>

      <ProductSection id="product-features" title={t("featuresHeading")}>
        <FeatureList />
      </ProductSection>

      <ProductSection id="product-costs" title={t("costs.heading")} lede={t("costs.lede")}>
        <CostTable />
      </ProductSection>

      <ProductSection id="product-privacy" title={t("privacyHeading")}>
        <ul className="grid max-w-[72ch] list-none grid-cols-1 gap-3 p-0 text-[15px] leading-normal">
          {PRIVACY.map((key) => (
            <li key={key} className="border-t border-rule pt-3">
              {t(`privacy.${key}`)}
            </li>
          ))}
        </ul>
        {/* Parity spec amendment 2026-09-29: the full list, generated from the registry. */}
        <p className="text-[15px]">
          <Link href="/assistant" className="text-primary-ink underline underline-offset-4">
            {t("assistantPageLink")}
          </Link>
        </p>
      </ProductSection>

      <ProductSection id="product-credits" title={t("creditsHeading")}>
        <p className="max-w-[72ch] text-[15px] leading-normal">{t("credits")}</p>
        <p className="text-[15px]">
          <Link href="/about" className="text-primary-ink underline underline-offset-4">
            {t("aboutLink")}
          </Link>
        </p>
      </ProductSection>

      <ProductSection id="product-closing" title={t("closingHeading")} lede={t("closingLede")}>
        <div className="flex flex-wrap gap-3">
          <Button asChild variant="default" className="h-10 px-5">
            <Link href={TRY_IT_HREF}>{t("tryIt")}</Link>
          </Button>
          <Button asChild variant="outline" className="h-10 px-5">
            <Link href={QUICK_START_HREF}>{t("quickStartCta")}</Link>
          </Button>
        </div>
      </ProductSection>
    </main>
  );
}
