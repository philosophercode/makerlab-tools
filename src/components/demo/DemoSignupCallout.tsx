import Link from "next/link";
import { useTranslations } from "next-intl";
import { MailIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { demoPassEnabled } from "../../lib/demo-pass/config";
import { siteConfig } from "../../lib/site-config";

/**
 * The way to the sign-up (demo pass spec 2026-10-07 §6, amendment
 * 2026-10-11): a callout box on the home page, between the search and the
 * categories. A heading ("Interested in bringing MakerLAB AI to your
 * makerspace?"), one short line, and **Sign up**, in a square box with the
 * accent ink border on the muted surface tint (both follow light and dark),
 * stacked under `sm` with the button full width. It replaces the bare
 * centred line of the first amendment, which the owner found easy to miss.
 * A server component with no JavaScript, so a cached prerender carries it;
 * nothing at all with `DEMO_PASS=off`.
 */
export function DemoSignupCallout() {
  const t = useTranslations("demoPass.callout");
  if (!demoPassEnabled()) return null;
  const label = t("label", { assistant: siteConfig.chatAssistantName });
  const heading = t("text", { assistant: siteConfig.chatAssistantName });

  return (
    <aside aria-label={label} data-slot="demo-callout" className="ui mx-auto mb-10 w-full max-w-3xl sm:mb-14">
      <div className="flex flex-col gap-4 border border-primary-ink bg-muted p-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:p-6">
        <div className="flex min-w-0 items-start gap-3">
          <MailIcon aria-hidden="true" className="mt-1 size-5 shrink-0 text-primary-ink" />
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="m-0 font-heading text-base leading-snug font-medium text-foreground sm:text-lg">{heading}</h2>
            <p className="m-0 text-sm leading-snug text-muted-foreground">{t("body")}</p>
          </div>
        </div>
        <Button asChild variant="default" className="w-full shrink-0 sm:w-auto">
          <Link href="/demo">{t("cta")}</Link>
        </Button>
      </div>
    </aside>
  );
}
