import Link from "next/link";
import { useTranslations } from "next-intl";
import { siteConfig } from "../../lib/site-config";

export const metadata = {
  title: `About — ${siteConfig.name}`,
};

export default function AboutPage() {
  const t = useTranslations("about");

  return (
    <main className="tool-detail">
      <section className="td-panel td-prose">
        <p className="td-eyebrow">{t("eyebrow")}</p>
        <h1>{t("title")}</h1>

        <p>{t("intro")}</p>
        <p>{t("origin")}</p>

        <h2>{t("builtByHeading")}</h2>
        <p>{t("builtByBody")}</p>

        <h2>{t("howItWorksHeading")}</h2>
        <p>{t("howItWorksBody")}</p>

        <p>{t("feedbackBody")}</p>

        <div className="td-prose-actions">
          <Link className="td-button" href="/">
            {t("browseTools")}
          </Link>
        </div>
      </section>
    </main>
  );
}
