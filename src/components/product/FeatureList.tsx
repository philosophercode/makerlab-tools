import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { FEATURES, SHOTS } from "../../app/product/product-content";
import { ProductShot } from "./ProductShot";

/**
 * The feature sections: words beside a screenshot, alternating sides from
 * `lg`, stacked (words first) on a phone. Each is an h3 under "What's in
 * it", so the page's outline reads as the feature list.
 */
export function FeatureList() {
  const t = useTranslations("product");
  return (
    <div className="flex flex-col gap-14 sm:gap-20">
      {FEATURES.map(({ key, shot }, index) => {
        const image = SHOTS[shot];
        const headingId = `feature-${key}`;
        return (
          <article
            key={key}
            aria-labelledby={headingId}
            data-feature={key}
            className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12 lg:gap-10"
          >
            <div className={cn("flex flex-col gap-3 lg:col-span-4 lg:pt-4", index % 2 === 1 && "lg:order-2")}>
              <h3 id={headingId} className="font-heading text-xl leading-tight font-medium normal-case sm:text-2xl">
                {t(`features.${key}.title`)}
              </h3>
              <p className="text-[15px] leading-normal">{t(`features.${key}.body`)}</p>
              {key === "actions" ? <p className="text-[15px] leading-normal text-muted-foreground">{t("features.actions.never")}</p> : null}
            </div>
            <ProductShot
              shot={image}
              alt={t(`features.${key}.alt`)}
              caption={image.demo ? t("demoCaption") : t("liveCaption")}
              sizes="(min-width: 1024px) 760px, 100vw"
              className={cn("lg:col-span-8", index % 2 === 1 && "lg:order-1")}
            />
          </article>
        );
      })}
    </div>
  );
}
