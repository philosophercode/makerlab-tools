import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { QUICK_START_HREF, SHOTS, TRY_IT_HREF } from "../../app/product/product-content";
import { ProductShot } from "./ProductShot";

/**
 * The product page's first screen: the assistant's name in display type (the
 * gallery hero's scale, DESIGN.md §4), what it does in one sentence, the one
 * orange action — Try it, straight to the X1-Carbon with the chat open — and
 * Quick start beside it, then the tool page itself.
 */
export function ProductHero() {
  const t = useTranslations("product");
  return (
    <header className="flex flex-col gap-8 pt-8 pb-4 sm:pt-12">
      <div className="flex max-w-[60rem] flex-col gap-4">
        <p className="font-mono text-label text-muted-foreground uppercase">
          <span aria-hidden="true" className="text-primary-ink">
            {"// "}
          </span>
          {t("heroKicker")}
        </p>
        <h1 className="font-heading text-[clamp(42px,8vw,96px)] leading-[0.92] font-medium tracking-tight normal-case">{t("heroTitle")}</h1>
        <p className="max-w-[60ch] text-lg leading-normal text-balance sm:text-xl">{t("heroLede")}</p>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button asChild variant="default" className="h-10 px-5">
            <Link href={TRY_IT_HREF} aria-describedby="product-try-hint">
              {t("tryIt")}
            </Link>
          </Button>
          <Button asChild variant="outline" className="h-10 px-5">
            <Link href={QUICK_START_HREF}>{t("quickStartCta")}</Link>
          </Button>
        </div>
        <p id="product-try-hint" className="text-sm text-muted-foreground">
          {t("tryItHint")}
        </p>
        <p className="font-mono text-label text-muted-foreground uppercase">{t("heroFacts")}</p>
      </div>
      <ProductShot shot={SHOTS.toolPage} alt={t("heroShotAlt")} caption={t("liveCaption")} sizes="(min-width: 1264px) 1200px, 100vw" priority />
    </header>
  );
}
