import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { PageSection, Prose, PublicPage } from "../../components/system/PublicPage";
import { siteConfig } from "../../lib/site-config";

export const metadata = {
  title: `About — ${siteConfig.name}`,
};

/** `/about` — a reading column on `PublicPage` (UI system phase 5a). */
export default function AboutPage() {
  const t = useTranslations("about");

  return (
    <PublicPage crumbs={[{ label: t("eyebrow") }]} title={t("title")}>
      <Prose className="pt-2">
        <p>{t("intro")}</p>
        <p>{t("origin")}</p>
      </Prose>

      <PageSection id="about-built-by" title={t("builtByHeading")}>
        <Prose>
          <p>{t("builtByBody")}</p>
        </Prose>
      </PageSection>

      <PageSection id="about-how" title={t("howItWorksHeading")}>
        <Prose>
          <p>{t("howItWorksBody")}</p>
          <p>{t("feedbackBody")}</p>
        </Prose>
      </PageSection>

      {/* MCP access spec §7, open question 4: list the MCP endpoint here; the
          link goes to the public /mcp page (amendment 2026-09-25). */}
      <PageSection id="about-mcp" title={t("mcpHeading")}>
        <Prose>
          <p>{t("mcpBody")}</p>
          <p>
            <Link href="/mcp">{t("mcpLink")}</Link>
          </p>
        </Prose>
      </PageSection>

      <div className="pt-8">
        <Button asChild variant="outline">
          <Link href="/">{t("browseTools")}</Link>
        </Button>
      </div>
    </PublicPage>
  );
}
