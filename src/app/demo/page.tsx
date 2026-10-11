import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { DemoSignupForm } from "../../components/demo/DemoSignupForm";
import { Prose, PublicPage } from "../../components/system/PublicPage";
import { demoPassEnabled } from "../../lib/demo-pass/config";
import { siteConfig } from "../../lib/site-config";

export const metadata = {
  title: `Bring ${siteConfig.chatAssistantName} to your makerspace`,
  description: `Interested in bringing ${siteConfig.chatAssistantName} to your makerspace? Sign up and we'll be in touch.`,
};

/**
 * `/demo` (demo pass spec 2026-10-07 §5.1, §6; amendment 2026-10-11): the
 * sign-up for people interested in bringing the assistant to their own
 * makerspace. The site is the demo, so the page says nothing about a pass;
 * submitting still issues one (§5.2), which raises the visitor's chat
 * allowance. Public and static; the form posts to `/api/demo-pass`. With
 * `DEMO_PASS=off` it says sign-ups are closed instead.
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
      title={t("title", { assistant: siteConfig.chatAssistantName })}
      lede={t("lede")}
      keepCase
    >
      <DemoSignupForm />
    </PublicPage>
  );
}
