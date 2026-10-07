import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { AdminNotice } from "../../../components/admin/AdminNotice";
import { AdminPageHeader } from "../../../components/admin/AdminPageHeader";
import { DecidedProposals } from "../../../components/admin/DecidedProposals";
import { ManualTriage } from "../../../components/admin/ManualTriage";
import { ActionProposalCard } from "../../../components/chat/ActionProposalCard";
import { EmptyState } from "../../../components/system/EmptyState";
import { LinkTabs } from "../../../components/system/LinkTabs";
import { areaOrderOf, buildInbox, type InboxView } from "../../../lib/actions/inbox";
import { buildManualTriage, triageToolIds, type ManualTriageView } from "../../../lib/actions/manual-triage";
import { ACTION_DEFINITIONS, actionById } from "../../../lib/actions/registry";
import { mayOpen, surface } from "../../../lib/admin/surfaces";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import { can } from "../../../lib/auth/permissions";
import { listInboxProposals, type ActionProposalRecord } from "../../../lib/data/action-proposals";
import { listOpenAssistantProposals, MCP_PROPOSAL_CHAT_ID } from "../../../lib/data/chat-proposals";
import { loadTriageTools } from "../../../lib/data/manual-triage-tools";

/**
 * `/admin/proposals` — the Settings section's **MCP** tab (admin sections spec
 * 2026-10-07: "Connected assistants" becomes MCP), which holds the **Assistant
 * proposals** inbox (assistant–GUI parity spec §3.8, §6; owner's §11 answers
 * 4, 7 and 11) and links to how to connect an assistant (`/mcp`) and the
 * viewer's access tokens (`/account/tokens`). The address is unchanged: the
 * MCP server's own instructions name it.
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
 * **Two views, one inbox** (amendment 2026-10-07 "manual triage"). **All
 * proposals** is the list of cards. **Manuals** (`?view=manuals`) shows the
 * same open resource proposals grouped by tool, with the tool's documents now,
 * for deciding many fast (`ManualTriage`). Both confirm through the same
 * route; only the Manuals view crosses calls, and only within one tool, where
 * every row is on screen.
 *
 * Field changes an MCP client proposed (`propose_change`) keep their own
 * review on `/admin/refresh`, where their citations are shown; this page
 * counts them and links there.
 */

export const metadata = {
  title: "MCP",
};

const MANUALS_HREF = "/admin/proposals?view=manuals";
const ALL_HREF = "/admin/proposals";

export default async function AdminProposalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = await getTranslations("actions.inbox");
  const tt = await getTranslations("actions.triage");
  const tm = await getTranslations("admin.mcp");
  const identity = await resolveIdentityFromHeaders();

  if (!identity.userId || !mayOpen(identity, surface("proposals"))) return <AdminNotice kind="forbidden" />;
  const manualsView = (await searchParams).view === "manuals";

  let rows: ActionProposalRecord[] | null;
  let view: InboxView | null = null;
  try {
    rows = await listInboxProposals(identity.userId);
    view = buildInbox(
      rows,
      (actionId) => actionById(actionId)?.risk,
      areaOrderOf(ACTION_DEFINITIONS.map((def) => def.id))
    );
  } catch (err) {
    console.error("[admin/proposals] could not read the inbox", err);
    rows = null;
  }
  const triageTools = rows ? triageToolIds(rows) : [];
  const triage = manualsView && rows ? await loadTriage(rows, triageTools) : null;
  const fieldChanges = can(identity, "tools.edit") ? await countFieldProposals() : 0;

  return (
    <section className="flex flex-col gap-4">
      <AdminPageHeader
        surface="proposals"
        title={tm("title")}
        lede={tm("lede")}
        facts={view ? [t("factsWaiting", { count: view.waiting }), t("factsDecided", { count: view.decided.length })] : []}
        actions={
          <>
            <Link href="/mcp" className={buttonVariants({ variant: "outline" })}>
              {tm("guide")}
            </Link>
            <Link href="/account/tokens" className={buttonVariants({ variant: "outline" })}>
              {tm("tokens")}
            </Link>
          </>
        }
      />

      <div className="ui flex flex-col gap-1">
        <h3 className="m-0 font-heading text-lg font-medium uppercase">{t("title")}</h3>
        <p className="m-0 max-w-[72ch] text-sm text-muted-foreground">{t("lede")}</p>
      </div>

      {view && triageTools.length > 0 ? (
        <LinkTabs
          label={tt("tabsLabel")}
          current={manualsView ? MANUALS_HREF : ALL_HREF}
          tabs={[
            { href: ALL_HREF, label: tt("tabAll") },
            { href: MANUALS_HREF, label: tt("tabManuals", { count: triageTools.length }) },
          ]}
        />
      ) : null}

      {fieldChanges > 0 && !manualsView ? (
        <p className="ui text-sm">
          {t("fieldChanges", { count: fieldChanges })}{" "}
          <Link className="text-primary-ink hover:underline" href="/admin/refresh">
            {t("fieldChangesLink")}
          </Link>
        </p>
      ) : null}

      {view === null ? <EmptyState tone="bad">{t("unavailable")}</EmptyState> : null}

      {manualsView && view ? (
        triage === null ? (
          <EmptyState tone="bad">{t("unavailable")}</EmptyState>
        ) : triage.tools.length === 0 ? (
          <EmptyState>{tt("empty")}</EmptyState>
        ) : (
          <>
            <p className="ui m-0 text-sm text-muted-foreground">{tt("lede", { count: triage.proposalCount, tools: triage.tools.length })}</p>
            <ManualTriage tools={triage.tools} />
          </>
        )
      ) : null}

      {!manualsView && view && view.areas.length === 0 ? <EmptyState>{t("empty")}</EmptyState> : null}

      {!manualsView
        ? view?.areas.map(({ area, cards }) => (
            <section key={area} className="ui flex flex-col gap-3" aria-labelledby={`proposals-area-${area}`}>
              <h3 id={`proposals-area-${area}`} className="font-heading text-lg font-medium uppercase">
                {t.has(`area.${area}` as "area.tools") ? t(`area.${area}` as "area.tools") : area}
              </h3>
              {cards.map((card) => (
                <ActionProposalCard key={card.groupId} payload={card} />
              ))}
            </section>
          ))
        : null}

      {!manualsView && view && view.decided.length > 0 ? <DecidedProposals rows={view.decided} /> : null}
    </section>
  );
}

/**
 * The Manuals view's data: the tools the open resource proposals name, with
 * their documents now. A read that fails is null: the page says the inbox
 * could not be loaded rather than showing rows without their tools.
 */
async function loadTriage(rows: ActionProposalRecord[], toolIds: string[]): Promise<ManualTriageView | null> {
  try {
    return buildManualTriage(rows, await loadTriageTools(toolIds));
  } catch (err) {
    console.error("[admin/proposals] could not read the tools for the Manuals view", err);
    return null;
  }
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
