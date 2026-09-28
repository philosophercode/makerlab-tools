import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { AdminNotice } from "../../../components/admin/AdminNotice";
import { AdminPageHeader } from "../../../components/admin/AdminPageHeader";
import { BusiestHeatmap } from "../../../components/admin/insights/BusiestHeatmap";
import { InsightsControls } from "../../../components/admin/insights/InsightsControls";
import { InsightsTabs } from "../../../components/admin/insights/InsightsTabs";
import { parseInsightsParams } from "../../../components/admin/insights/insights-params";
import { InsightsSummary } from "../../../components/admin/insights/InsightsSummary";
import { InsightsToolTable } from "../../../components/admin/insights/InsightsToolTable";
import { ManualsCitedTable } from "../../../components/admin/insights/ManualsCitedTable";
import { QuestionKinds } from "../../../components/admin/insights/QuestionKinds";
import { UnansweredQueue } from "../../../components/admin/insights/UnansweredQueue";
import { EmptyState } from "../../../components/system/EmptyState";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import { can } from "../../../lib/auth/permissions";
import { isoDay } from "../../../lib/iso-day";
import { labTimezone } from "../../../lib/lab-time";
import { siteConfig } from "../../../lib/site-config";
import { loadInsights, type InsightsData } from "../../../lib/usage/queries";
import { dismissUnanswered, fileUnansweredAsCorrection } from "./actions";

/**
 * `/admin/insights` — **Insights** (usage insight spec §6, phases 1–2 plus the
 * Unanswered queue's two decisions): what the lab asks about, from anonymous
 * usage counts. `insights.view` (admins and super admins), and says so when
 * refused.
 *
 * Header controls pick the period (7 / 30 / 90 days) and whether staff are
 * counted (off by default); then the totals, the tools most and never asked
 * about, the kinds of question over time, the busiest hours in lab time, the
 * manuals cited and the Unanswered queue. Uncached: a count is a picture of
 * now. Counts that could not be read say so; they are never zeros.
 */

export const metadata = {
  title: `Insights — ${siteConfig.name}`,
};

function validTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

export default async function AdminInsightsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = await getTranslations("admin.insights");
  const identity = await resolveIdentityFromHeaders();
  if (!can(identity, "insights.view")) return <AdminNotice kind="forbidden" />;

  const params = parseInsightsParams(await searchParams);
  const timeZone = validTimeZone(labTimezone());

  let data: InsightsData | null;
  try {
    data = await loadInsights({ days: params.days, includeStaff: params.includeStaff, timeZone });
  } catch (err) {
    console.error("[admin/insights] could not read the usage counts", err);
    data = null;
  }

  const header = (facts: string[] = []) => (
    <>
      <AdminPageHeader surface="insights" title={t("title")} lede={t("lede")} facts={facts} actions={<InsightsControls params={params} />} />
      <InsightsTabs />
    </>
  );

  if (!data) {
    return (
      <section className="flex flex-col gap-4">
        {header()}
        <EmptyState tone="bad">{t("unreadable")}</EmptyState>
      </section>
    );
  }

  const facts = [
    t("facts.period", { days: params.days }),
    params.includeStaff ? t("facts.staffIncluded") : t("facts.staffExcluded"),
    data.since ? t("facts.since", { date: isoDay(data.since) }) : null,
    t("facts.approximate"),
  ].filter((fact): fact is string => Boolean(fact));

  if (!data.since) {
    return (
      <section className="flex flex-col gap-4">
        {header(facts)}
        <EmptyState>{t("empty")}</EmptyState>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-8">
      {header(facts)}
      <InsightsSummary totals={data.totals} />
      <Section id="insights-gaps" title={t("gaps.heading")} note={t("gaps.note")} facts={t("gaps.facts", data.gapCounts)}>
        <UnansweredQueue gaps={data.gaps} fileCorrection={fileUnansweredAsCorrection} dismiss={dismissUnanswered} />
      </Section>
      <Section id="insights-tools" title={t("tools.heading")}>
        <InsightsToolTable tools={data.tools} quiet={data.neverAsked} />
      </Section>
      <div className="grid gap-8 lg:grid-cols-2">
        <Section id="insights-kinds" title={t("kinds.heading")}>
          <QuestionKinds kinds={data.kinds} />
        </Section>
        <Section id="insights-busiest" title={t("heatmap.heading")}>
          <BusiestHeatmap heatmap={data.heatmap} timeZone={timeZone} />
        </Section>
      </div>
      <Section id="insights-manuals" title={t("manuals.heading")}>
        <ManualsCitedTable manuals={data.manuals} />
      </Section>
    </section>
  );
}

function Section({ id, title, note, facts, children }: { id: string; title: string; note?: string; facts?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-heading`} className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 id={`${id}-heading`} className="font-heading text-lg font-medium uppercase">
          {title}
        </h3>
        {facts ? <p className="m-0 font-mono text-xs text-muted-foreground tabular-nums">{facts}</p> : null}
        {note ? <p className="m-0 max-w-[78ch] text-sm text-muted-foreground">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}
