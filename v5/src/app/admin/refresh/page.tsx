import { getTranslations } from "next-intl/server";
import { AdminNotice } from "../../../components/admin/AdminNotice";
import { AdminPageHeader } from "../../../components/admin/AdminPageHeader";
import { EmptyState } from "../../../components/system/EmptyState";
import { RefreshList, type RefreshListRow } from "../../../components/admin/RefreshList";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import { can } from "../../../lib/auth/permissions";
import { listRefreshQueue } from "../../../lib/data/tool-refreshes";
import { listOpenAssistantProposals, MCP_PROPOSAL_CHAT_ID } from "../../../lib/data/chat-proposals";
import { ChatProposalCards, type ChatProposalItem } from "../../../components/ChatProposalCards";
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

  const byStatus = (...statuses: string[]) => (rows ?? []).filter((row) => statuses.includes(row.status)).length;

  return (
    <section className="flex flex-col gap-4">
      <AdminPageHeader
        surface="refresh"
        title={t("refreshTitle")}
        lede={t("refreshLede")}
        facts={
          rows
            ? [
                t("facts.waiting", { count: byStatus("proposed") }),
                t("facts.running", { count: byStatus("queued", "researching") }),
                t("facts.failed", { count: byStatus("failed") }),
              ]
            : [t("facts.unreadable")]
        }
      />
      {rows ? (
        <RefreshList rows={rows} />
      ) : (
        <EmptyState tone="bad">{t("refresh.unavailable")}</EmptyState>
      )}
      <AssistantProposals />
    </section>
  );
}

/**
 * "Proposals from assistants" — changes an admin's AI assistant proposed over
 * MCP (`propose_change`, MCP access spec §3.3), waiting for a person. Each is
 * a card with Accept / Reject through `POST /api/chat-proposals`, the path the
 * chat's own cards take: accepting writes through the editor's revision check
 * (Article 5). Nothing is shown when there are none.
 */
async function AssistantProposals() {
  const t = await getTranslations("admin.refresh");
  let rows;
  try {
    rows = await listOpenAssistantProposals(MCP_PROPOSAL_CHAT_ID);
  } catch (err) {
    console.error("[admin/refresh] could not read assistant proposals", err);
    return (
      <EmptyState tone="bad">{t("assistantUnavailable")}</EmptyState>
    );
  }
  if (rows.length === 0) return null;

  const byTool = new Map<string, { name: string; items: ChatProposalItem[]; proposedBy: Set<string> }>();
  for (const row of rows) {
    const group = byTool.get(row.toolId) ?? { name: row.toolName, items: [], proposedBy: new Set<string>() };
    group.items.push({
      kind: "proposal",
      proposalId: row.id,
      subject: { kind: "tool", id: row.toolId, name: row.toolName },
      proposal: row.proposal,
    });
    if (row.proposedBy) group.proposedBy.add(row.proposedBy);
    byTool.set(row.toolId, group);
  }

  return (
    <section className="ui mt-6 flex flex-col gap-2" aria-labelledby="assistant-proposals-heading">
      <h3 id="assistant-proposals-heading" className="font-heading text-lg font-medium uppercase">
        {t("assistantHeading")}
      </h3>
      <p className="max-w-[72ch] text-sm text-muted-foreground">{t("assistantLede")}</p>
      {[...byTool.entries()].map(([toolId, group]) => (
        <div key={toolId} className="flex flex-col gap-1 py-2">
          <h4 className="font-mono text-label font-medium uppercase">{group.name}</h4>
          {group.proposedBy.size > 0 ? (
            <p className="text-xs text-muted-foreground">{t("assistantBy", { names: [...group.proposedBy].join(", ") })}</p>
          ) : null}
          <ChatProposalCards items={group.items} />
        </div>
      ))}
    </section>
  );
}
