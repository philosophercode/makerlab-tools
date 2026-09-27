import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Prose, PublicPage } from "../../../components/system/PublicPage";
import { siteConfig } from "../../../lib/site-config";

/**
 * `/auth/blocked` — where a blocked address lands when it tries to sign up
 * (auth spec amendment 2026-09-25, "Remove a person, and block an address").
 * `BLOCKED_SIGN_IN_PATH` in `lib/auth/blocked-sign-in.ts` points here.
 *
 * The twin of `/auth/rejected`, in its words and its shape, and under the same
 * rule: **it must not dead-end.** No account was created; the catalogue and the
 * assistant are open to anonymous visitors, and the page says so.
 */

export const metadata = {
  title: `Sign-in — ${siteConfig.name}`,
};

export default function AuthBlockedPage() {
  const t = useTranslations("auth");

  return (
    <PublicPage width="narrow" crumbs={[{ label: t("eyebrow") }]} title={t("blockedTitle", { site: siteConfig.name })}>
      <Prose className="pt-2">
        <p>{t("blockedBody", { site: siteConfig.name })}</p>
        <p>{t("stillWorks")}</p>
      </Prose>
      <div className="pt-6">
        <Button asChild variant="default">
          <Link href="/">{t("browseTools")}</Link>
        </Button>
      </div>
    </PublicPage>
  );
}
