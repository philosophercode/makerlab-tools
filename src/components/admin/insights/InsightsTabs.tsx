import { useTranslations } from "next-intl";
import { INSIGHTS_PATH, VALUE_REPORT_PATH } from "../../../app/admin/insights/action-result";
import { LinkTabs } from "../../system/LinkTabs";

/**
 * Insights' two views as tabs that are pages: **Usage** (`/admin/insights`)
 * and **Value report** (`/admin/insights/value`). Not printed.
 */
export function InsightsTabs() {
  const t = useTranslations("admin.insights.tabs");
  return (
    <LinkTabs
      label={t("label")}
      className="print:hidden"
      tabs={[
        { href: INSIGHTS_PATH, label: t("usage") },
        { href: VALUE_REPORT_PATH, label: t("value") },
      ]}
    />
  );
}
