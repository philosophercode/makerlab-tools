import { getTranslations } from "next-intl/server";
import { AdminNotice } from "../../../components/admin/AdminNotice";
import { AdminPageHeader } from "../../../components/admin/AdminPageHeader";
import { ManualLibrary } from "../../../components/admin/ManualLibrary";
import { ManualStateStrip } from "../../../components/admin/ManualStateStrip";
import { StarterAnswerTable } from "../../../components/admin/StarterAnswerTable";
import { EmptyState } from "../../../components/system/EmptyState";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import { can } from "../../../lib/auth/permissions";
import { countManualsByState, listManualLibrary } from "../../../lib/data/manual-chunks";
import { getDb } from "../../../lib/db/client";
import { siteConfig } from "../../../lib/site-config";
import { loadStarterChipRows, type StarterChipAdminRow } from "../../../lib/starters/admin-rows";
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
  // The starter chips' cache (starter answers) is read on its own: a failure
  // there says so in its section and leaves the manual library standing.
  let starterRows: StarterChipAdminRow[] | null = null;
  try {
    const db = await getDb();
    const [counts, rows, starters] = await Promise.all([
      countManualsByState(db),
      listManualLibrary(db),
      loadStarterChipRows(db).catch((err: unknown) => {
        console.error("[admin/research] could not read the starter answers", err);
        return null;
      }),
    ]);
    data = { counts, rows };
    starterRows = starters;
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
      <section aria-labelledby="starter-answers" className="flex flex-col gap-3 pt-4">
        <h2 id="starter-answers" className="font-heading text-base font-medium">
          {t("research.starters.title")}
        </h2>
        <p className="ui max-w-[78ch] text-sm leading-normal text-muted-foreground">{t("research.starters.note")}</p>
        {starterRows ? <StarterAnswerTable rows={starterRows} /> : <EmptyState tone="bad">{t("research.starters.unreadable")}</EmptyState>}
      </section>
    </section>
  );
}
