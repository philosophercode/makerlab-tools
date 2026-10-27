import Link from "next/link";
import { useTranslations } from "next-intl";
import { MailIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { demoPassEnabled } from "../../lib/demo-pass/config";
import { siteConfig } from "../../lib/site-config";

/**
 * The way to the sign-up (demo pass spec 2026-10-07 §6, amendment
 * 2026-10-11): "Interested in bringing MakerLAB AI to your makerspace?" and
 * **Sign up**. A server component with no JavaScript, so a cached prerender
 * carries it; nothing at all with `DEMO_PASS=off`.
 *
 * Two looks, one content:
 *
 * - `inline` — the home page (student home spec 2026-10-07): one centred
 *   line between the smart search and the categories, no box. The home is
 *   white space and one search box; a band across it would be the "Start
 *   here" band the owner removed. Since the amendment of 2026-10-11 the line
 *   is the heading face at reading size in the text colour, with the filled
 *   button, so it is seen without becoming a band.
 * - `box` (default) — above the full list on `/tools`: a bordered card the
 *   width of the page, the CTA filled.
 */
export function DemoSignupCallout({ variant = "box" }: { variant?: "box" | "inline" }) {
  const t = useTranslations("demoPass.callout");
  if (!demoPassEnabled()) return null;
  const label = t("label", { assistant: siteConfig.chatAssistantName });
  const text = t("text", { assistant: siteConfig.chatAssistantName });

  if (variant === "inline") {
    return (
      <aside
        aria-label={label}
        data-slot="demo-callout"
        data-variant="inline"
        className="ui mx-auto -mt-4 mb-12 flex w-full max-w-3xl flex-col items-center gap-3 px-4 text-center sm:-mt-8 sm:mb-16 sm:flex-row sm:justify-center sm:gap-4 sm:text-start"
      >
        <p className="m-0 flex items-start gap-2 font-heading text-base leading-snug font-medium text-foreground sm:text-lg">
          <MailIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary-ink sm:mt-1" />
          <span>{text}</span>
        </p>
        <Button asChild variant="default" className="shrink-0">
          <Link href="/interest">{t("cta")}</Link>
        </Button>
      </aside>
    );
  }

  return (
    <aside aria-label={label} className="ui mx-auto w-full max-w-[1440px] px-4 pt-4 sm:px-8" data-slot="demo-callout" data-variant="box">
      <div className="flex flex-col gap-3 border border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="m-0 flex items-start gap-2 text-sm leading-snug">
          <MailIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary-ink" />
          <span>{text}</span>
        </p>
        <Button asChild variant="default" className="w-full sm:w-auto">
          <Link href="/interest">{t("cta")}</Link>
        </Button>
      </div>
    </aside>
  );
}
