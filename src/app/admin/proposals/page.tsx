import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AdminNotice } from "../../../components/admin/AdminNotice";
import { AdminPageHeader } from "../../../components/admin/AdminPageHeader";
import { DecidedProposals } from "../../../components/admin/DecidedProposals";
import { ActionProposalCard } from "../../../components/chat/ActionProposalCard";
import { EmptyState } from "../../../components/system/EmptyState";
import { areaOrderOf, buildInbox, type InboxView } from "../../../lib/actions/inbox";
import { ACTION_DEFINITIONS, actionById } from "../../../lib/actions/registry";
import { mayOpen, surface } from "../../../lib/admin/surfaces";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import { can } from "../../../lib/auth/permissions";
import { listInboxProposals } from "../../../lib/data/action-proposals";
import { listOpenAssistantProposals, MCP_PROPOSAL_CHAT_ID } from "../../../lib/data/chat-proposals";

/**
 * `/admin/proposals` — the **Assistant proposals** inbox (assistant–GUI parity
 * spec §3.8, §6; owner's §11 answers 4, 7 and 11).
 *
 * An AI assistant connected over MCP (Claude Code, ChatGPT…) cannot draw a
 * confirmation card, so a change it asks for is stored as a proposal with
 * `surface = mcp` and waits here for **7 days**. Only **the person whose
 * connection proposed it** sees it or can confirm it: every row read here is
 * the viewer's own, and the confirm route (`POST /api/action-proposals`,
 * cookie only) claims only its creator's rows, so a leaked token can put a
 * card in front of its owner and nobody else — and can never press it.
 *
 * Each card is the chat's `ActionProposalCard`, drawn from the stored
 * proposal, never from the assistant's words; Confirm runs the stored input
 * through `performAction` with the permission and every rule checked again,
 * audited with `surface: mcp`. Cards are grouped by area and never mix
 * proposals from two calls, so bulk confirm never crosses a group (§6).
 *
 * Field changes an MCP client proposed (`propose_change`) keep their own
 * review on `/admin/refresh`, where their citations are shown; this page
 * counts them and links there.
 */

export const metadata = {
  title: "Assistant proposals",
};

export default async function AdminProposalsPage() {
  const t = await getTranslations("actions.inbox");
  const identity = await resolveIdentityFromHeaders();

  if (!identity.userId || !mayOpen(identity, surface("proposals"))) return <AdminNotice kind="forbidden" />;

  let view: InboxView | null;
  try {
    view = buildInbox(
      await listInboxProposals(identity.userId),
      (actionId) => actionById(actionId)?.risk,
      areaOrderOf(ACTION_DEFINITIONS.map((def) => def.id))
    );
  } catch (err) {
    console.error("[admin/proposals] could not read the inbox", err);
    view = null;
  }
  const fieldChanges = can(identity, "tools.edit") ? await countFieldProposals() : 0;

  return (
    <section className="flex flex-col gap-4">
      <AdminPageHeader
        surface="proposals"
        title={t("title")}
        lede={t("lede")}
        facts={view ? [t("factsWaiting", { count: view.waiting }), t("factsDecided", { count: view.decided.length })] : []}
      />

      {fieldChanges > 0 ? (
        <p className="ui text-sm">
          {t("fieldChanges", { count: fieldChanges })}{" "}
          <Link className="text-primary-ink hover:underline" href="/admin/refresh">
            {t("fieldChangesLink")}
          </Link>
        </p>
      ) : null}

      {view === null ? <EmptyState tone="bad">{t("unavailable")}</EmptyState> : null}
      {view && view.areas.length === 0 ? <EmptyState>{t("empty")}</EmptyState> : null}

      {view?.areas.map(({ area, cards }) => (
        <section key={area} className="ui flex flex-col gap-3" aria-labelledby={`proposals-area-${area}`}>
          <h3 id={`proposals-area-${area}`} className="font-heading text-lg font-medium uppercase">
            {t.has(`area.${area}` as "area.tools") ? t(`area.${area}` as "area.tools") : area}
          </h3>
          {cards.map((card) => (
            <ActionProposalCard key={card.groupId} payload={card} />
          ))}
        </section>
      ))}

      {view && view.decided.length > 0 ? <DecidedProposals rows={view.decided} /> : null}
    </section>
  );
}

/**
 * How many field changes MCP clients proposed are waiting on `/admin/refresh`.
 * A read that fails is 0 here: this page's own inbox still answers, and the
 * Refresh page says for itself that it could not load them.
 */
async function countFieldProposals(): Promise<number> {
  try {
    return (await listOpenAssistantProposals(MCP_PROPOSAL_CHAT_ID)).length;
  } catch (err) {
    console.error("[admin/proposals] could not count field proposals", err);
    return 0;
  }
}
