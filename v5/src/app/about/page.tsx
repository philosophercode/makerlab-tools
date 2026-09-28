import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { PageSection, Prose, PublicPage } from "../../components/system/PublicPage";
import { siteConfig } from "../../lib/site-config";
import { ABOUT_LINKS, ABOUT_PEOPLE } from "./about-content";

export const metadata = {
  title: `About — ${siteConfig.name}`,
  description: `The ${siteConfig.institution} MakerLAB, and ${siteConfig.name}: ${siteConfig.tagline}.`,
};

/**
 * `/about` (identity spec 2026-09-28 §6): about the MakerLAB first, in the
 * order of Cornell Tech's own MakerLAB page — what it is, where and when,
 * who runs it, the community, where to learn more — then
 * this site and its assistant. A reading column on `PublicPage`. Facts are
 * paraphrased from the pages linked here; the official page is the authority
 * for hours and access.
 */
export default function AboutPage() {
  const t = useTranslations("about");

  return (
    <PublicPage crumbs={[{ label: t("eyebrow") }]} title={t("title")} lede={t("lede")} keepCase>
      <PageSection keepCase id="about-lab" title={t("labHeading")}>
        <Prose>
          <p>{t("labBody")}</p>
          <p>{t("historyBody")}</p>
        </Prose>
      </PageSection>

      <PageSection keepCase id="about-visit" title={t("visitHeading")}>
        <Prose>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
            <dt className="font-mono text-label tracking-[0.08em] text-muted-foreground uppercase sm:pt-0.5">{t("whereLabel")}</dt>
            <dd>{t("where")}</dd>
            <dt className="font-mono text-label tracking-[0.08em] text-muted-foreground uppercase sm:pt-0.5">{t("hoursLabel")}</dt>
            <dd>{t("hours")}</dd>
          </dl>
          <p>
            {t("hoursNote")} <a href={ABOUT_LINKS.official}>{t("officialLink")}</a>
          </p>
        </Prose>
      </PageSection>

      <PageSection keepCase id="about-people" title={t("peopleHeading")}>
        <ul className="flex flex-col gap-3">
          {ABOUT_PEOPLE.map((person) => (
            <li key={person.email} className="flex flex-col gap-0.5 text-sm">
              <span className="font-medium">{person.name}</span>
              <span className="text-muted-foreground">{t(person.roleKey)}</span>
              <a className="w-fit text-primary-ink underline-offset-4 hover:underline" href={`mailto:${person.email}`} aria-label={t("emailLabel", { name: person.name })}>
                {person.email}
              </a>
            </li>
          ))}
        </ul>
      </PageSection>

      <PageSection keepCase id="about-community" title={t("communityHeading")}>
        <Prose>
          <p>{t("communityBody")}</p>
        </Prose>
      </PageSection>

      <PageSection keepCase id="about-resources" title={t("resourcesHeading")}>
        <Prose>
          <ul>
            <li>
              <a href={ABOUT_LINKS.official}>{t("officialLink")}</a>
            </li>
            <li>
              <a href={ABOUT_LINKS.youtube}>{t("youtubeLink")}</a>
            </li>
            <li>
              <a href={ABOUT_LINKS.instagram}>{t("instagramLink")}</a>
            </li>
          </ul>
        </Prose>
      </PageSection>

      <PageSection keepCase id="about-this-project" title={t("projectHeading")}>
        <Prose>
          <p>{t("projectBody")}</p>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
            {(["operate", "debug", "create"] as const).map((mode) => (
              <div key={mode} className="contents">
                <dt className="font-mono text-label tracking-[0.08em] text-muted-foreground uppercase sm:pt-0.5">{t(`${mode}Label`)}</dt>
                <dd>“{t(`${mode}Body`)}”</dd>
              </div>
            ))}
          </dl>
          <p>{t("assistantLimits")}</p>
          {/* Usage insight spec §8, §13 Q6: one sentence on what is counted. */}
          <p>{t("usageBody")}</p>
          <p>{t("whyBody")}</p>
          <p>{t("creditsBody")}</p>
          <p>{t("feedbackBody")}</p>
          {/* Product page amendment 2026-09-28: the product page and quick start are linked here and from the footer, not the main nav. */}
          <p>
            <Link href="/product">{t("productLink")}</Link> · <Link href="/product/quick-start">{t("quickStartLink")}</Link>
          </p>
        </Prose>
      </PageSection>

      {/* MCP access spec §7, open question 4: list the MCP endpoint here; the
          link goes to the public /mcp page (amendment 2026-09-25). */}
      <PageSection keepCase id="about-mcp" title={t("mcpHeading")}>
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
