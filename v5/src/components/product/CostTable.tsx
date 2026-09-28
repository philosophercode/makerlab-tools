import { useTranslations } from "next-intl";
import { COST_MONTHLY, COST_ROWS } from "../../app/product/product-content";

/**
 * What it costs to run: two small tables — per unit of work, and a typical
 * month — with the numbers right-aligned in mono (UI system §3.2), hairline
 * rows, and the note saying what each number covers. Costs only; never a
 * price (pricing is a separate decision).
 */
export function CostTable() {
  const t = useTranslations("product.costs");
  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
      <CostGroup caption={t("unitLabel")} rows={COST_ROWS.map((row) => ({ ...row, label: t(`rows.${row.key}.label`), note: t(`rows.${row.key}.note`) }))} />
      <div className="flex flex-col gap-6">
        <CostGroup caption={t("monthlyLabel")} rows={COST_MONTHLY.map((row) => ({ ...row, label: t(`monthly.${row.key}.label`), note: t(`monthly.${row.key}.note`) }))} />
        <p className="max-w-[60ch] text-[15px] leading-normal">{t("compare")}</p>
        <p className="max-w-[60ch] text-sm leading-normal text-muted-foreground">{t("footnote")}</p>
      </div>
    </div>
  );
}

function CostGroup({ caption, rows }: { caption: string; rows: { key: string; value: string; label: string; note: string }[] }) {
  return (
    <table data-cost-table className="w-full border-collapse text-left text-sm">
      <caption className="pb-2 text-left font-mono text-label tracking-[0.08em] text-muted-foreground uppercase">{caption}</caption>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} data-cost={row.key} className="border-t border-rule align-top">
            <th scope="row" className="py-3 pr-4 font-normal">
              <span className="block font-medium">{row.label}</span>
              <span className="block text-muted-foreground">{row.note}</span>
            </th>
            <td className="py-3 text-right font-mono text-base whitespace-nowrap tabular-nums">{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
