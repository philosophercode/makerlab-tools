import { getTranslations } from "next-intl/server";
import { AdminNotice } from "../../../components/admin/AdminNotice";
import { AdminPageHeader } from "../../../components/admin/AdminPageHeader";
import { ManualLibrary } from "../../../components/admin/ManualLibrary";
import { ManualStateStrip } from "../../../components/admin/ManualStateStrip";
import { EmptyState } from "../../../components/system/EmptyState";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import { can } from "../../../lib/auth/permissions";
import { countManualsByState, listManualLibrary } from "../../../lib/data/manual-chunks";
import { getDb } from "../../../lib/db/client";
import { siteConfig } from "../../../lib/site-config";
import { reprocessLibraryManual } from "./actions";

/**
 * `/admin/research` — **Manuals**: the lab's manual library (manual text spec
 * §5 "Admin"; public polish). A facts line and a compact strip of counts by
 * state, then every current manual PDF on the shared `DataTable` with a State
 * facet and **Re-process** per row, and one plain sentence on how manuals get
 * read. Requires `tools.edit`, and says so when refused. Uncached: a count is
 * a picture of now. A library that could not be read says so; it is never an
 * empty list.
 */

export const metadata = {
  title: `Manuals — ${siteConfig.name}`,
};

export default async function AdminResearchPage() {
  const t = await getTranslations("admin");
  const identity = await resolveIdentityFromHeaders();
  if (!can(identity, "tools.edit")) return <AdminNotice kind="forbidden" />;

  let data;
  try {
    const db = await getDb();
    const [counts, rows] = await Promise.all([countManualsByState(db), listManualLibrary(db)]);
    data = { counts, rows };
  } catch (err) {
    console.error("[admin/research] could not read the manual library", err);
    data = null;
  }

  const header = (facts?: string[]) => (
    <AdminPageHeader surface="research" title={t("researchTitle")} lede={t("researchLede")} facts={facts} />
  );

  if (!data) {
    return (
      <section className="flex flex-col gap-4">
        {header()}
        <EmptyState tone="bad">{t("research.unreadable")}</EmptyState>
      </section>
    );
  }

  const { counts, rows } = data;
  const total = counts.searchable + counts.textOnly + counts.noText + counts.failed + counts.processing;

  return (
    <section className="flex flex-col gap-5">
      {header([
        t("facts.manuals", { count: total }),
        t("facts.searchable", { count: counts.searchable }),
        t("facts.failed", { count: counts.failed }),
      ])}
      <ManualStateStrip counts={counts} />
      <p className="ui max-w-[78ch] text-sm leading-normal text-muted-foreground">{t("research.note")}</p>
      <ManualLibrary rows={rows} reprocess={reprocessLibraryManual} />
    </section>
  );
}
