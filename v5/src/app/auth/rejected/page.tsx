import Link from "next/link";
import { useTranslations } from "next-intl";
import { siteConfig } from "../../../lib/site-config";

/**
 * `/auth/rejected` — where a non-institutional Google account lands (auth design
 * spec §5, §6). `DOMAIN_REJECTED_PATH` in `lib/auth/config.ts` points here.
 *
 * The one rule for this page: **it must not dead-end.** Someone who just picked
 * the wrong Google account has done nothing wrong and loses nothing — the
 * catalog and the assistant are open to anonymous visitors, and the page says
 * so and links straight back to them. A stack trace here is on the spec's list
 * of things that would embarrass us in production (§10).
 */

export const metadata = {
  title: `Sign-in — ${siteConfig.name}`,
};

export default function AuthRejectedPage() {
  const t = useTranslations("auth");

  return (
    <main className="tool-detail">
      <section className="td-panel td-prose">
        <p className="td-eyebrow">{t("eyebrow")}</p>
        <h1>{t("title", { institution: siteConfig.institution })}</h1>

        <p>
          {t("body", {
            site: siteConfig.name,
            institution: siteConfig.institution,
          })}
        </p>
        <p>{t("stillWorks")}</p>

        <div className="td-prose-actions">
          <Link className="td-button" href="/">
            {t("browseTools")}
          </Link>
        </div>
      </section>
    </main>
  );
}
