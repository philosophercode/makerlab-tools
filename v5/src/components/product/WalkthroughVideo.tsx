import { useTranslations } from "next-intl";
import { WALKTHROUGH } from "../../app/product/product-content";

const TRANSCRIPT = ["one", "two", "three", "four"] as const;

/**
 * The 49-second walkthrough (identity spec amendment 2026-09-28): never
 * autoplays and loads nothing but its poster until played
 * (`preload="none"`), English captions on by default, and the same story as
 * text in a disclosure for anyone who can't or won't watch.
 */
export function WalkthroughVideo() {
  const t = useTranslations("product");
  return (
    <div className="flex flex-col gap-3">
      <video
        controls
        playsInline
        preload="none"
        poster={WALKTHROUGH.poster}
        width={WALKTHROUGH.width}
        height={WALKTHROUGH.height}
        aria-label={t("videoLabel")}
        className="block h-auto w-full border border-border bg-card"
      >
        <source src={WALKTHROUGH.mp4} type="video/mp4" />
        <source src={WALKTHROUGH.webm} type="video/webm" />
        <track kind="captions" src={WALKTHROUGH.captions} srcLang="en" label="English" default />
        {t("videoFallback")} <a href={WALKTHROUGH.mp4}>{t("videoDownload")}</a>
      </video>
      <details className="text-[15px] leading-normal">
        <summary className="cursor-pointer font-mono text-label tracking-[0.08em] text-primary-ink uppercase">{t("transcriptSummary")}</summary>
        <ol className="mt-3 flex max-w-[72ch] list-decimal flex-col gap-2 pl-5">
          {TRANSCRIPT.map((key) => (
            <li key={key}>{t(`transcript.${key}`)}</li>
          ))}
        </ol>
      </details>
    </div>
  );
}
