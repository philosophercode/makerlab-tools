import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { AdminNotice } from "../../../../components/admin/AdminNotice";
import { AdminPageHeader } from "../../../../components/admin/AdminPageHeader";
import { InsightsTabs } from "../../../../components/admin/insights/InsightsTabs";
import { ValueAssumptionsForm } from "../../../../components/admin/insights/value/ValueAssumptionsForm";
import { ValuePeriodPicker } from "../../../../components/admin/insights/value/ValuePeriodPicker";
import { periodName, valueReportCsv, valueReportViewModel, type Translate } from "../../../../components/admin/insights/value/value-report-model";
import { ValueReportExport } from "../../../../components/admin/insights/value/ValueReportExport";
import { ValueReportView } from "../../../../components/admin/insights/value/ValueReportView";
import { EmptyState } from "../../../../components/system/EmptyState";
import { resolveIdentityFromHeaders } from "../../../../lib/auth/identity";
import { can } from "../../../../lib/auth/permissions";
import { labTimezone } from "../../../../lib/lab-time";
import { siteConfig } from "../../../../lib/site-config";
import { defaultAssumptions } from "../../../../lib/usage/value/assumptions";
import { loadValueReport, type ValueReportData } from "../../../../lib/usage/value/load";
import { recentTerms } from "../../../../lib/usage/value/periods";
import { saveValueAssumptions } from "../actions";

/**
 * `/admin/insights/value` — the **value report** (usage insight spec
 * amendment "Value report"): per term or date range, questions answered,
 * the share handled without staff, estimated staff hours and dollars saved,
 * after-hours coverage and follow-up work, beside the previous period, with
 * the formulas in plain words. Printable on one page and downloadable as CSV.
 *
 * `insights.view` to read (the Insights page's own gate); the assumptions
 * under it are editable with `insights.configure`. Anonymous counts only,
 * staff left out. Uncached: a count is a picture of now; an unreadable count
 * says so rather than reading as zero.
 */

export const metadata = {
  title: "Value report",
};

function validTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

export default async function ValueReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = (await getTranslations("admin.insights")) as unknown as Translate;
  const identity = await resolveIdentityFromHeaders();
  if (!can(identity, "insights.view")) return <AdminNotice kind="forbidden" />;

  const timeZone = validTimeZone(labTimezone());
  let data: ValueReportData | null;
  try {
    data = await loadValueReport({ search: await searchParams, timeZone, labHoursText: siteConfig.labHours });
  } catch (err) {
    console.error("[admin/insights/value] could not read the value report", err);
    data = null;
  }

  const header = (facts: string[] = [], actions?: ReactNode) => (
    <>
      <AdminPageHeader surface="insights" title={t("value.title")} lede={t("value.lede")} facts={facts} actions={actions} />
      <InsightsTabs />
    </>
  );

  if (!data) {
    return (
      <section className="flex flex-col gap-4">
        {header()}
        <EmptyState tone="bad">{t("value.unreadable")}</EmptyState>
      </section>
    );
  }

  const brand = { assistant: siteConfig.chatAssistantName, labName: `${siteConfig.name} · ${siteConfig.institution}` };
  const model = valueReportViewModel(data, t, brand);
  const { csv, fileName } = valueReportCsv(data, model.title, t);
  const terms = recentTerms(data.today, data.assumptions.assumptions.terms).map((period) => ({ period, label: periodName(period, t) }));
  const facts = [t("value.facts.period", { period: periodName(data.period, t) }), t("value.facts.staffExcluded"), t("value.facts.estimate")];

  return (
    <section className="flex flex-col gap-6">
      {header(facts, <ValueReportExport csv={csv} fileName={fileName} />)}
      <ValuePeriodPicker period={data.period} terms={terms} />
      <ValueReportView model={model} />
      <ValueAssumptionsForm
        assumptions={data.assumptions.assumptions}
        defaults={defaultAssumptions(siteConfig.labHours)}
        canEdit={can(identity, "insights.configure")}
        timeZone={timeZone}
        save={saveValueAssumptions}
      />
    </section>
  );
}
