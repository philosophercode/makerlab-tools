import { useTranslations } from "next-intl";
import { answeredPercent } from "../../../lib/usage/answered";
import type { InsightTotals } from "../../../lib/usage/queries";

export { answeredPercent };

/**
 * The period's totals as one compact strip (the Manuals page's
 * `ManualStateStrip` idiom): label left, number right-aligned and tabular.
 * "Answered" is 1 − unanswered turns ÷ questions (`lib/usage/answered.ts`,
 * shared with MCP's `get_usage_summary`), shown only once there is a question
 * to divide by.
 */
const KEYS = ["chatTurns", "mcpCalls", "toolViews", "qrScans", "kioskScreens", "kioskScans", "citations", "crossToolCitations", "gaps"] as const;

export function InsightsSummary({ totals }: { totals: InsightTotals }) {
  const t = useTranslations("admin.insights.summary");
  const answered = answeredPercent(totals);
  const rows: Array<{ key: string; label: string; value: string; zero: boolean }> = [
    ...KEYS.map((key) => ({ key, label: t(key), value: String(totals[key]), zero: totals[key] === 0 })),
    ...(answered === null ? [] : [{ key: "answered", label: t("answered"), value: t("answeredValue", { percent: answered }), zero: false }]),
  ];
  return (
    <dl aria-label={t("label")} data-slot="insights-summary" className="ui grid grid-cols-1 border-t border-rule text-table sm:grid-cols-2 lg:grid-cols-3 lg:gap-x-8">
      {rows.map((row) => (
        <div key={row.key} data-insight-total={row.key} className="flex items-baseline justify-between gap-3 border-b border-rule py-1.5">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className={`font-mono tabular-nums ${row.zero ? "text-muted-foreground" : ""}`}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
