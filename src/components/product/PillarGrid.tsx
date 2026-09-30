import { useTranslations } from "next-intl";
import { PILLARS, SHOTS } from "../../app/product/product-content";
import { ProductShot } from "./ProductShot";

/**
 * Operate / debug / create as three small multiples (UI system §3.7): the
 * same layout each — label, the real question, what it means, the real answer
 * — so the differences are the content. One column on a phone, three from `md`.
 */
export function PillarGrid() {
  const t = useTranslations("product");
  return (
    <ol className="grid list-none grid-cols-1 gap-10 p-0 md:grid-cols-3 md:gap-6">
      {PILLARS.map(({ key, shot }) => (
        <li key={key} data-pillar={key} className="flex min-w-0 flex-col gap-3">
          <h3 className="font-mono text-label tracking-[0.08em] text-primary-ink uppercase">{t(`pillars.${key}.label`)}</h3>
          <p className="font-heading text-lg leading-snug font-medium">“{t(`pillars.${key}.question`)}”</p>
          <p className="text-sm leading-normal text-muted-foreground">{t(`pillars.${key}.body`)}</p>
          <ProductShot
            shot={SHOTS[shot]}
            alt={t(`pillars.${key}.alt`)}
            caption={t("liveCaption")}
            sizes="(min-width: 768px) 33vw, 100vw"
            className="mx-auto w-full max-w-[440px]"
          />
        </li>
      ))}
    </ol>
  );
}
