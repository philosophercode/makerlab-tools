import type { Metadata } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PageSection, PublicPage } from "../../../components/system/PublicPage";
import { ProductShot } from "../../../components/product/ProductShot";
import { productMetadata } from "../metadata";
import { PRODUCT_HREF, QUICK_START_STEPS, SHOTS, THINGS_TO_TRY } from "../product-content";

export const metadata: Metadata = productMetadata("quickStart");

/**
 * `/product/quick-start` (identity spec amendment 2026-09-28 "Product page
 * and quick start"): eight numbered steps, each with a screenshot — four for
 * anyone, three for staff, then connecting your own AI — and a list of things
 * to try. A `PublicPage` reading column; the steps are an ordered list so the
 * numbering is the document's, not decoration.
 */
export default function QuickStartPage() {
  const t = useTranslations("product");
  return (
    <PublicPage
      crumbs={[{ label: t("eyebrow"), href: PRODUCT_HREF }, { label: t("quickStartPage.title") }]}
      title={t("quickStartPage.title")}
      lede={t("quickStartPage.lede")}
      keepCase
    >
      <ol className="flex list-none flex-col gap-12 p-0 pt-4">
        {QUICK_START_STEPS.map(({ key, shot, staff }, index) => {
          const headingId = `step-${key}`;
          const image = SHOTS[shot];
          return (
            <li key={key} data-step={key} aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3">
              <p className="flex items-center gap-3 font-mono text-label tracking-[0.08em] uppercase">
                <span className="text-primary-ink">{t("quickStartPage.stepLabel", { n: index + 1 })}</span>
                {staff ? <span className="border border-border px-1.5 py-0.5 text-muted-foreground">{t("quickStartPage.staffBadge")}</span> : null}
              </p>
              <h2 id={headingId} className="font-heading text-xl leading-tight font-medium normal-case sm:text-2xl">
                {t(`quickStart.steps.${key}.title`)}
              </h2>
              <p className="max-w-[72ch] text-[15px] leading-normal">{t(`quickStart.steps.${key}.body`)}</p>
              <ProductShot
                shot={image}
                alt={t(`quickStart.steps.${key}.alt`)}
                caption={image.demo ? t("demoCaption") : t("liveCaption")}
                sizes="(min-width: 944px) 880px, 100vw"
                priority={index === 0}
                className={image.width < image.height ? "max-w-[440px]" : undefined}
              />
            </li>
          );
        })}
      </ol>

      <PageSection keepCase id="quick-start-try" title={t("quickStart.tryHeading")}>
        <ul className="flex list-none flex-col p-0 text-[15px]">
          {THINGS_TO_TRY.map(({ key, href }) => (
            <li key={key} className="border-t border-rule py-2.5">
              <Link href={href} className="text-primary-ink underline-offset-4 hover:underline">
                {t(`quickStart.try.${key}`)}
              </Link>
            </li>
          ))}
        </ul>
      </PageSection>

      <p className="pt-10 text-[15px]">
        <Link href={PRODUCT_HREF} className="text-primary-ink underline underline-offset-4">
          {t("quickStartPage.backToProduct")}
        </Link>
      </p>
    </PublicPage>
  );
}
