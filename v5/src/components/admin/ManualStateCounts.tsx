import { useTranslations } from "next-intl";
import type { ManualStateCounts as Counts } from "../../lib/data/manual-chunks";

/**
 * The manual library by state (manual text spec §5 "Admin"), for
 * `/admin/research`: one row per state, then the pages and passages stored.
 * Presentational; the page reads the counts.
 */
export function ManualStateCounts({ counts }: { counts: Counts }) {
  const t = useTranslations("admin.research");
  const rows: { key: keyof Counts; label: string }[] = [
    { key: "searchable", label: t("searchable") },
    { key: "textOnly", label: t("textOnly") },
    { key: "noText", label: t("noText") },
    { key: "failed", label: t("failed") },
    { key: "processing", label: t("processing") },
  ];
  return (
    <div className="admin-manual-counts td-panel">
      <h3>{t("manualsHeading")}</h3>
      <dl className="admin-mirror-facts" aria-label={t("manualsHeading")}>
        {rows.map((row) => (
          <div key={row.key} data-manual-count={row.key}>
            <dt>{row.label}</dt>
            <dd>{counts[row.key]}</dd>
          </div>
        ))}
        <div data-manual-count="pages">
          <dt>{t("pages")}</dt>
          <dd>{counts.pages}</dd>
        </div>
        <div data-manual-count="passages">
          <dt>{t("passages")}</dt>
          <dd>{counts.passages}</dd>
        </div>
      </dl>
      <p className="admin-cell-note">{t("note")}</p>
    </div>
  );
}
