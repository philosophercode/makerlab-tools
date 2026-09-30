import Link from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { VALUE_REPORT_PATH } from "../../../../app/admin/insights/action-result";
import { periodQuery, type ReportPeriod } from "../../../../lib/usage/value/periods";
import { Button } from "../../../ui/button";
import { Input } from "../../../ui/input";

/**
 * The report's period (usage insight spec amendment "Value report"): the
 * recent terms as links, and a custom range as a plain GET form — no script,
 * and every choice a URL a director can bookmark or send. Not printed.
 */
export function ValuePeriodPicker({ period, terms }: { period: ReportPeriod; terms: { period: ReportPeriod; label: string }[] }) {
  const t = useTranslations("admin.insights.value.picker");
  const segment = "inline-flex h-8 items-center border border-outline-strong px-3 font-mono text-label tracking-[0.08em] uppercase whitespace-nowrap";
  return (
    <div role="group" aria-label={t("label")} data-slot="value-period" className="ui flex flex-col gap-3 print:hidden">
      <nav aria-label={t("terms")} className="flex flex-wrap">
        {terms.map((term, i) => {
          const current = period.kind === "term" && term.period.key === period.key;
          return (
            <Link
              key={term.period.key}
              href={`${VALUE_REPORT_PATH}?${periodQuery(term.period)}`}
              aria-current={current ? "page" : undefined}
              className={cn(segment, i > 0 && "-ms-px", current ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
            >
              {term.label}
            </Link>
          );
        })}
      </nav>
      <form method="get" action={VALUE_REPORT_PATH} aria-label={t("custom")} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase">
          {t("from")}
          <Input type="date" name="from" required defaultValue={period.from} className="w-40" />
        </label>
        <label className="flex flex-col gap-1 font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase">
          {t("to")}
          <Input type="date" name="to" required defaultValue={period.to} className="w-40" />
        </label>
        <Button type="submit" variant={period.kind === "custom" ? "default" : "quiet"}>
          {t("show")}
        </Button>
      </form>
    </div>
  );
}
