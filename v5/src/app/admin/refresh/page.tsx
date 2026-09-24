import { getTranslations } from "next-intl/server";
import { AdminNotice } from "../../../components/admin/AdminNotice";
import { RefreshList, type RefreshListRow } from "../../../components/admin/RefreshList";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import { can } from "../../../lib/auth/permissions";
import { listRefreshQueue } from "../../../lib/data/tool-refreshes";
import { countByKind, refreshRank } from "../../../lib/refresh/types";
import { siteConfig } from "../../../lib/site-config";

/**
 * `/admin/refresh` — refreshes waiting for a decision (refresh research spec
 * §5.2, §6). Requires `tools.edit`, said rather than a 404 when missing.
 *
 * Ordered by what matters: safety *differs*, safety *new*, other *differs*,
 * other *new*, nothing to change — failed refreshes (waiting for **Refresh
 * again**) and running ones after. Uncached: `RefreshList` polls while a run is
 * going. A database that cannot be reached is said, never an empty list.
 */

export const metadata = {
  title: `Refresh research — ${siteConfig.name}`,
};

/** Where a status sorts when it has no proposals to rank by. */
const STATUS_RANK: Record<string, number> = { proposed: 0, failed: 5, researching: 6, queued: 7, decided: 8 };

export default async function AdminRefreshPage() {
  const t = await getTranslations("admin");
  const identity = await resolveIdentityFromHeaders();
  if (!can(identity, "tools.edit")) return <AdminNotice kind="forbidden" />;

  let rows: RefreshListRow[] | null;
  try {
    rows = (await listRefreshQueue())
      .map((refresh) => {
        const proposals = refresh.proposals ?? [];
        return {
          id: refresh.id,
          toolName: refresh.toolName,
          status: refresh.status,
          rank: refresh.status === "proposed" ? refreshRank(proposals) : STATUS_RANK[refresh.status] ?? 9,
          counts: countByKind(proposals),
          researchError: refresh.researchError,
          requestedAt: refresh.createdAt.toISOString(),
        };
      })
      .sort((a, b) => a.rank - b.rank || a.toolName.localeCompare(b.toolName));
  } catch (err) {
    console.error("[admin/refresh] could not read the queue", err);
    rows = null;
  }

  return (
    <section className="admin-section">
      <header className="admin-section-head">
        <p className="td-eyebrow">{t("eyebrow")}</p>
        <h2>{t("refreshTitle")}</h2>
        <p className="admin-lede">{t("refreshLede")}</p>
      </header>
      {rows ? (
        <RefreshList rows={rows} />
      ) : (
        <p className="admin-empty td-empty" role="alert">
          {t("refresh.unavailable")}
        </p>
      )}
    </section>
  );
}
