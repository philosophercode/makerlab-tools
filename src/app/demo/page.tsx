import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { DemoSignupForm } from "../../components/demo/DemoSignupForm";
import { Prose, PublicPage } from "../../components/system/PublicPage";
import { DEMO_PASS_DAYS, demoPassBudgetUsd, demoPassEnabled } from "../../lib/demo-pass/config";
import { siteConfig } from "../../lib/site-config";

export const metadata = {
  title: "Try the demo",
  description: `Sign up for a free demo pass to try ${siteConfig.name} and its assistant.`,
};

/**
 * `/demo` (demo pass spec 2026-10-07 §5.1, §6): the demo pass sign-up, for
 * visitors whose address Google sign-in does not admit. Public and static; the
 * form posts to `/api/demo-pass`. With `DEMO_PASS=off` it says sign-ups are
 * closed instead.
 */
export default function DemoPage() {
  const t = useTranslations("demoPass");
  const crumbs = [{ label: t("eyebrow") }];

  if (!demoPassEnabled()) {
    return (
      <PublicPage width="narrow" crumbs={crumbs} title={t("closedTitle")} keepCase>
        <Prose className="pt-4">
          <p>{t("closedBody")}</p>
        </Prose>
        <div className="pt-6">
          <Button asChild variant="outline">
            <Link href="/">{t("browseTools")}</Link>
          </Button>
        </div>
      </PublicPage>
    );
  }

  return (
    <PublicPage
      width="narrow"
      crumbs={crumbs}
      title={t("title")}
      lede={t("lede", { site: siteConfig.name, institution: siteConfig.institution })}
      keepCase
    >
      <DemoSignupForm budgetUsd={demoPassBudgetUsd()} days={DEMO_PASS_DAYS} />
    </PublicPage>
  );
}
