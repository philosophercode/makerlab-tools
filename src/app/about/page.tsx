import Image from "next/image";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "../../components/BrandLogo";
import { PageSection, Prose, PublicPage } from "../../components/system/PublicPage";
import { demoPassEnabled } from "../../lib/demo-pass/config";
import { lab, localized } from "../../lib/lab/config";
import { siteConfig } from "../../lib/site-config";

export const metadata = {
  title: "About",
  description: `The ${siteConfig.institution} ${lab.identity.labName}, and ${siteConfig.name}: ${siteConfig.tagline}.`,
};

/**
 * `/about` (identity spec 2026-09-28 §6): about the lab first — what it is,
 * where and when, who runs it, the community, where to learn more — then
 * this site and its assistant. A reading column on `PublicPage`, the lab's
 * official logo under the title (`BrandLogo`). The lab's own words come from
 * the lab config (`about`, `people`, `links`, `photos`; lab config spec §12.1),
 * in the visitor's locale when the config gives it, else English; the words
 * around them are messages. The official page is the authority for hours and
 * access.
 */
export default function AboutPage() {
  const t = useTranslations("about");
  const locale = useLocale();
  const text = (value: Parameters<typeof localized>[0]) => localized(value, locale);
  const { about, links, people, photos } = lab;

  return (
    <PublicPage crumbs={[{ label: t("eyebrow") }]} title={text(about.title)} lede={text(about.lede)} keepCase>
      {/* The lab's official logo under the title (amendment 2026-10-06). */}
      <BrandLogo className="mt-8 h-14 text-foreground sm:h-16" />
      <PageSection keepCase id="about-lab" title={t("labHeading")}>
        <Prose>
          {about.body.map((paragraph, index) => (
            <p key={index}>{text(paragraph)}</p>
          ))}
        </Prose>
        {/* Photos of the lab: one column on a phone, two from sm up. */}
        {photos.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {photos.map((photo) => (
              <figure key={photo.src} className="flex min-w-0 flex-col gap-2">
                <Image
                  src={photo.src}
                  width={photo.width}
                  height={photo.height}
                  alt={text(photo.alt)}
                  sizes="(min-width: 40rem) 24rem, 100vw"
                  className="h-auto w-full border border-border"
                />
                {photo.caption ? (
                  <figcaption className="font-mono text-label tracking-[0.08em] text-muted-foreground uppercase">
                    {text(photo.caption)}
                  </figcaption>
                ) : null}
              </figure>
            ))}
          </div>
        ) : null}
      </PageSection>

      <PageSection keepCase id="about-visit" title={t("visitHeading")}>
        <Prose>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
            <dt className="font-mono text-label tracking-[0.08em] text-muted-foreground uppercase sm:pt-0.5">
              {t("whereLabel")}
            </dt>
            <dd>{text(about.where)}</dd>
            <dt className="font-mono text-label tracking-[0.08em] text-muted-foreground uppercase sm:pt-0.5">
              {t("hoursLabel")}
            </dt>
            <dd>{text(about.hours)}</dd>
          </dl>
          {about.hoursNote || links.official ? (
            <p>
              {about.hoursNote ? text(about.hoursNote) : null}
              {about.hoursNote && links.official ? " " : null}
              {links.official ? <a href={links.official.href}>{text(links.official.label)}</a> : null}
            </p>
          ) : null}
        </Prose>
      </PageSection>

      {people.length > 0 ? (
        <PageSection keepCase id="about-people" title={t("peopleHeading")}>
          <ul className="flex flex-col gap-3">
            {people.map((person) => (
              <li key={person.name} className="flex flex-col gap-0.5 text-sm">
                <span className="font-medium">{person.name}</span>
                {/* As written, in every locale (lab config spec §11 Q2). */}
                <span className="text-muted-foreground">{person.title}</span>
                {person.email ? (
                  <a
                    className="w-fit text-primary-ink underline-offset-4 hover:underline"
                    href={`mailto:${person.email}`}
                    aria-label={t("emailLabel", { name: person.name })}
                  >
                    {person.email}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </PageSection>
      ) : null}

      {about.community ? (
        <PageSection keepCase id="about-community" title={t("communityHeading")}>
          <Prose>
            <p>{text(about.community)}</p>
          </Prose>
        </PageSection>
      ) : null}

      <PageSection keepCase id="about-resources" title={t("resourcesHeading")}>
        <Prose>
          <ul>
            {[...(links.official ? [links.official] : []), ...links.more].map((link) => (
              <li key={link.href}>
                <a href={link.href}>{text(link.label)}</a>
              </li>
            ))}
            {/* Amendment "Source code and forking" (2026-10-21): the licence and the code. */}
            <li>
              <a href={siteConfig.sourceUrl} target="_blank" rel="noopener">
                {t("sourceLink")}
              </a>
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
                <dt className="font-mono text-label tracking-[0.08em] text-muted-foreground uppercase sm:pt-0.5">
                  {t(`${mode}Label`)}
                </dt>
                <dd>“{t(`${mode}Body`)}”</dd>
              </div>
            ))}
          </dl>
          <p>{t("assistantLimits")}</p>
          <p>
            <Link href="/assistant">{t("assistantPageLink")}</Link>
          </p>
          {/* Usage insight spec §8, §13 Q6: one sentence on what is counted. */}
          <p>{t("usageBody")}</p>
          <p>{t("whyBody")}</p>
          {about.thanks ? <p>{text(about.thanks)}</p> : null}
          <p>{t("creditsBody")}</p>
          <p>{t("feedbackBody")}</p>
          {/* Product page amendment 2026-09-28: the product page and quick start are linked here and from the footer, not the main nav. */}
          {lab.pages.product ? (
            <p>
              <Link href="/product">{t("productLink")}</Link> ·{" "}
              <Link href="/product/quick-start">{t("quickStartLink")}</Link>
            </p>
          ) : null}
        </Prose>
      </PageSection>

      {/* Demo pass spec 2026-10-07 §6, amendment 2026-10-11: the sign-up, for
          people who would like the assistant in their own makerspace. */}
      {demoPassEnabled() ? (
        <PageSection keepCase id="about-demo" title={t("demoHeading", { assistant: siteConfig.chatAssistantName })}>
          <Prose>
            <p>{t("demoBody")}</p>
          </Prose>
          <div>
            <Button asChild variant="default">
              <Link href="/demo">{t("demoCta")}</Link>
            </Button>
          </div>
        </PageSection>
      ) : null}

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
