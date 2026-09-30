import Link from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { INSIGHT_PERIODS } from "../../../lib/usage/queries";
import { insightsHref, type InsightsParams } from "./insights-params";

/**
 * The header controls (usage insight spec §6): the period (7 / 30 / 90 days)
 * and "Include staff", off by default. Links, not state: each choice is a URL
 * somebody can send, and the page is rendered for it on the server.
 */
export function InsightsControls({ params }: { params: InsightsParams }) {
  const t = useTranslations("admin.insights.controls");
  const segment = "inline-flex h-8 items-center border border-outline-strong px-3 font-mono text-label tracking-[0.08em] uppercase";
  return (
    <div role="group" aria-label={t("label")} data-slot="insights-controls" className="ui flex flex-wrap items-center gap-3">
      <nav aria-label={t("period")} className="inline-flex">
        {INSIGHT_PERIODS.map((days, i) => {
          const current = days === params.days;
          return (
            <Link
              key={days}
              href={insightsHref({ ...params, days })}
              aria-current={current ? "page" : undefined}
              className={cn(segment, i > 0 && "-ms-px", current ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
            >
              {t("days", { days })}
            </Link>
          );
        })}
      </nav>
      <Link
        href={insightsHref({ ...params, includeStaff: !params.includeStaff })}
        aria-pressed={params.includeStaff}
        role="button"
        className={cn(segment, params.includeStaff ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
      >
        {params.includeStaff ? t("staffOn") : t("staffOff")}
      </Link>
    </div>
  );
}
