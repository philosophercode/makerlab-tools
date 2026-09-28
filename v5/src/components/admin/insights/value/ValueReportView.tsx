import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import "../../../../styles/value-report-print.css";
import type { BreakdownRow, ValueReportViewModel } from "./value-report-model";

/**
 * The value report itself (usage insight spec amendment "Value report"): the
 * one page a lab director prints for a dean. Headline numbers with the
 * previous period beside them, the formulas in plain words with this period's
 * numbers in them, the most-asked tools, the kinds of questions, follow-up
 * work, and the assumptions it all rests on.
 *
 * Presentational only — every string arrives built (`value-report-model.ts`),
 * so the page, the print and the CSV say the same thing. `data-value-report`
 * is what the print stylesheet keeps on paper; everything else on the page is
 * left off.
 */
export function ValueReportView({ model }: { model: ValueReportViewModel }) {
  const t = useTranslations("admin.insights.value");
  return (
    <article data-value-report aria-labelledby="value-report-title" className="ui flex flex-col gap-6 border border-rule bg-card p-5 sm:p-6 print:gap-3 print:border-0 print:p-0">
      <header className="flex flex-col gap-1 border-b border-rule pb-4 print:gap-0.5 print:pb-2">
        <p className="m-0 font-mono text-label tracking-[0.08em] text-muted-foreground uppercase">{model.labName}</p>
        <h3 id="value-report-title" className="m-0 font-heading text-2xl font-medium normal-case print:text-xl">
          {model.title}
        </h3>
        <p className="m-0 font-mono text-xs text-muted-foreground tabular-nums">{model.dates}</p>
        <p className="m-0 max-w-[80ch] text-sm text-muted-foreground print:max-w-none print:text-[8pt]">{t("estimateNote")}</p>
        {model.since ? <p className="m-0 text-sm text-warn print:text-[8pt]">{model.since}</p> : null}
      </header>

      <dl aria-label={t("metrics.label")} className="m-0 grid grid-cols-1 gap-px bg-rule sm:grid-cols-2 lg:grid-cols-5 print:grid-cols-5">
        {model.cards.map((card) => (
          <div key={card.key} data-value-metric={card.key} className="flex flex-col gap-1 bg-card p-3 print:p-1.5">
            <dt className="flex items-center gap-2 font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase">
              {card.label}
              {card.estimate ? <span className="border border-outline-strong px-1 text-[0.625rem] tracking-[0.06em]">{t("estimateBadge")}</span> : null}
            </dt>
            <dd className="m-0 flex flex-col gap-0.5">
              <span className="font-heading text-3xl leading-none font-medium tabular-nums print:text-2xl">{card.value}</span>
              <span className="text-xs text-muted-foreground">{card.detail}</span>
              <span className="font-mono text-micro text-muted-foreground tabular-nums">{card.change}</span>
            </dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="value-formulas-heading" className="flex flex-col gap-2 break-inside-avoid">
        <h4 id="value-formulas-heading" className="m-0 font-heading text-base font-medium uppercase">
          {t("formulas.heading")}
        </h4>
        <ol className="m-0 flex list-decimal flex-col gap-1.5 ps-5 text-sm leading-snug print:gap-0.5 print:text-[8.5pt]">
          {model.formulas.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
        <p className="m-0 text-xs text-muted-foreground print:text-[7.5pt]">{t("formulas.note")}</p>
      </section>

      <div className="grid gap-6 md:grid-cols-3 print:grid-cols-3 print:gap-4">
        <Breakdown id="value-tools" title={t("breakdown.tools")} rows={model.tools} empty={t("breakdown.toolsEmpty")} ordered />
        <Breakdown id="value-kinds" title={t("breakdown.kinds")} rows={model.kinds} />
        <Breakdown id="value-follow-up" title={t("breakdown.followUp")} rows={model.followUp} />
      </div>

      <footer className="flex flex-col gap-1 border-t border-rule pt-3 text-xs text-muted-foreground print:pt-1.5 print:text-[7.5pt]">
        <p className="m-0">{model.assumptions}</p>
        {model.assumptionsState ? <p className="m-0">{model.assumptionsState}</p> : null}
      </footer>
    </article>
  );
}

function Breakdown({ id, title, rows, empty, ordered = false }: { id: string; title: string; rows: BreakdownRow[]; empty?: string; ordered?: boolean }) {
  const List = ordered ? "ol" : "ul";
  return (
    <section aria-labelledby={`${id}-heading`} className="flex min-w-0 flex-col gap-2 break-inside-avoid">
      <h4 id={`${id}-heading`} className="m-0 font-heading text-base font-medium uppercase">
        {title}
      </h4>
      {rows.length === 0 && empty ? (
        <p className="m-0 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <List aria-labelledby={`${id}-heading`} className="m-0 list-none p-0 text-sm print:text-[8.5pt]">
          {rows.map((row, i) => (
            <li key={row.key} data-value-row={row.key} className={cn("flex items-baseline justify-between gap-3 border-b border-rule py-1 print:py-0.5")}>
              <span className="min-w-0">
                {ordered ? <span className="me-1 font-mono text-xs text-muted-foreground tabular-nums">{i + 1}.</span> : null}
                {row.label}
              </span>
              <span className="shrink-0 font-mono tabular-nums">{row.value}</span>
            </li>
          ))}
        </List>
      )}
    </section>
  );
}
