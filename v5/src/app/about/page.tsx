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

        {/* MCP access spec §7, open question 4: list the MCP endpoint here; the
            link goes to the public /mcp page (amendment 2026-09-25). */}
        <h2>{t("mcpHeading")}</h2>
        <p>{t("mcpBody")}</p>
        <p>
          <Link href="/mcp">{t("mcpLink")}</Link>
        </p>

        <div className="td-prose-actions">
          <Link className="td-button" href="/">
            {t("browseTools")}
          </Link>
        </div>
      </section>
    </main>
  );
}
