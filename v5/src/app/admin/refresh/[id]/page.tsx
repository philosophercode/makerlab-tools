import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AdminNotice } from "../../../../components/admin/AdminNotice";
import { RefreshReview, type RefreshReviewView } from "../../../../components/admin/RefreshReview";
import { resolveIdentityFromHeaders } from "../../../../lib/auth/identity";
import { can } from "../../../../lib/auth/permissions";
import { findDuplicate } from "../../../../lib/data/duplicates";
import {
  closeEmptyRefresh,
  getRefresh,
  getRefreshRowRevision,
  loadRefreshSubject,
} from "../../../../lib/data/tool-refreshes";
import { isActionable } from "../../../../lib/refresh/types";
import { siteConfig } from "../../../../lib/site-config";
import { ADMIN_REFRESH_PATH, type RefreshReviewActions } from "../action-result";
import { decideRefreshProposals, refreshAgain } from "../actions";

/**
 * `/admin/refresh/[id]` — one tool's proposals (refresh research spec §5.2,
 * §6). `tools.edit`.
 *
 * One card per proposal, safety first; **Accept** / **Reject** on each,
 * **Accept all verified**, **Reject all**, **Refresh again** (with a note) and
 * **Open in editor**. Research's category suggestion and a likely duplicate are
 * notes here, never proposals (§2 non-goals). A refresh with nothing to change
 * says "Matches the manufacturer's pages" and closes as `decided` when viewed.
 *
 * Uncached, and the row revision it renders with is what the decision actions
 * compare against, so two admins cannot overwrite each other's cards.
 */

export const metadata = {
  title: `Refresh research — ${siteConfig.name}`,
};

const ACTIONS: RefreshReviewActions = { decide: decideRefreshProposals, again: refreshAgain };

export default async function AdminRefreshItemPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getTranslations("admin");
  const identity = await resolveIdentityFromHeaders();
  if (!can(identity, "tools.edit")) return <AdminNotice kind="forbidden" />;

  const { id } = await params;
  const refresh = await getRefresh(id);
  const subject = refresh ? await loadRefreshSubject(refresh.toolId) : null;
  if (!refresh || !subject) {
    return (
      <section className="admin-section">
        <p className="admin-empty td-empty">{t("errors.not_found")}</p>
        <Link href={ADMIN_REFRESH_PATH}>{t("refresh.back")}</Link>
      </section>
    );
  }

  let status = refresh.status;
  const proposals = refresh.proposals ?? [];
  if (status === "proposed" && !proposals.some(isActionable)) {
    // Nothing to decide: say so, and close it (§5.2).
    if (await closeEmptyRefresh(refresh.id, identity.userId)) status = "decided";
  }

  const research = refresh.research;
  const duplicate =
    research && research.canonicalName
      ? await findDuplicate({ name: research.canonicalName }, { excludeToolIds: [subject.id] }).catch(() => null)
      : null;
  const suggested = research?.category.name?.trim() || null;

  const view: RefreshReviewView = {
    id: refresh.id,
    status,
    rowRevision: (await getRefreshRowRevision(refresh.id)) ?? "",
    tool: { id: subject.id, name: subject.name, slug: subject.slug, published: subject.published, archived: subject.archived },
    proposals,
    note: refresh.note,
    includeDescription: refresh.includeDescription,
    researchError: refresh.researchError,
    categorySuggestion: suggested && suggested !== subject.categoryName ? suggested : null,
    duplicateOf: duplicate && duplicate.kind === "tool" ? { name: duplicate.name, slug: duplicate.slug } : null,
    canPublish: can(identity, "tools.publish"),
  };

  return (
    <section className="admin-section">
      <header className="admin-section-head">
        <p className="td-eyebrow">
          <Link href={ADMIN_REFRESH_PATH}>{t("refresh.back")}</Link>
        </p>
        <h2>{subject.name}</h2>
        <p className="admin-lede">{t("refreshLede")}</p>
      </header>
      <RefreshReview view={view} actions={ACTIONS} />
    </section>
  );
}
