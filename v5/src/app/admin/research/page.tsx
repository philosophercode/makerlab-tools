import { getTranslations } from "next-intl/server";
import { AdminNotice } from "../../../components/admin/AdminNotice";
import { ManualStateCounts } from "../../../components/admin/ManualStateCounts";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import { can } from "../../../lib/auth/permissions";
import { countManualsByState } from "../../../lib/data/manual-chunks";
import { getDb } from "../../../lib/db/client";
import { siteConfig } from "../../../lib/site-config";

/**
 * `/admin/research` — the state of the lab's manual library (manual text spec
 * §5 "Admin": "on `/admin/research` a count of manuals by state").
 *
 * The page did not exist before phase 2 of that spec; today it holds only the
 * manual counts — searchable, text only, scanned, failed, processing — which
 * answer the spec's open question of how many manuals are scans, and whether
 * the backfill still has work. Requires `tools.edit`, and says so when refused.
 * Uncached: a count is a picture of now.
 */

export const metadata = {
  title: `Research — ${siteConfig.name}`,
};

export default async function AdminResearchPage() {
  const t = await getTranslations("admin");
  const identity = await resolveIdentityFromHeaders();
  if (!can(identity, "tools.edit")) return <AdminNotice kind="forbidden" />;

  const counts = await countManualsByState(await getDb());

  return (
    <section className="admin-section">
      <header className="admin-section-head">
        <p className="td-eyebrow">{t("eyebrow")}</p>
        <h2>{t("researchTitle")}</h2>
        <p className="admin-lede">{t("researchLede")}</p>
      </header>
      <ManualStateCounts counts={counts} />
    </section>
  );
}
