import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { AdminNotice } from "../../../../components/admin/AdminNotice";
import { AdminPageHeader } from "../../../../components/admin/AdminPageHeader";
import { AllowanceGrant } from "../../../../components/admin/AllowanceGrant";
import { SettingsBlock } from "../../../../components/admin/SettingsBlock";
import { EmptyState } from "../../../../components/system/EmptyState";
import { mayOpen, surface } from "../../../../lib/admin/surfaces";
import { resolveIdentityFromHeaders } from "../../../../lib/auth/identity";
import { can } from "../../../../lib/auth/permissions";
import { listActiveAllowances } from "../../../../lib/data/research-allowances";
import { listUsers } from "../../../../lib/data/users";
import { ALLOWANCE_PERMISSION, IMPORT_PERMISSION } from "../../../../lib/import/access";
import { RESEARCH_DAILY_ITEM_LIMIT, RESEARCH_ESTIMATED_USD_PER_ITEM, RESEARCH_MAX_ITEMS_PER_REQUEST } from "../../../../lib/intake/limits";
import { grantSetupAllowance } from "../../users/allowance-actions";
import type { AllowanceCandidate } from "../../users/allowance-result";

/**
 * `/admin/settings/ai-agents` — the Settings section's **AI agents** tab
 * (admin sections spec 2026-10-07; owner's decision: "Research budget moves
 * under an AI agents area"). What the lab's background agents do, the limits
 * they run under, and the **research budget**: the setup allowances a
 * director grants (bulk intake spec §4.2), which used to close the People
 * roster.
 *
 * - **Research agent**: researches equipment added through Add equipment and
 *   re-researches published tools from Check for updates. Nothing it finds is
 *   published until a person approves it.
 * - **Intake agent**: reads an imported list, matches rows to tools the lab
 *   already has and suggests names (`importParse`, `nameSuggest`).
 *
 * Open to `tools.edit` (SuperMakers and directors). The budget's grant form is
 * shown only to `users.manage` holders, and its action checks that again; a
 * SuperMaker reads one line saying who can grant more.
 */

export const metadata = {
  title: "AI agents",
};

export default async function AdminAiAgentsPage() {
  const t = await getTranslations("admin.agents");
  const identity = await resolveIdentityFromHeaders();

  if (!mayOpen(identity, surface("agents"))) return <AdminNotice kind="forbidden" />;

  const canGrant = can(identity, ALLOWANCE_PERMISSION);
  const candidates = canGrant ? await loadCandidates() : null;
  const low = RESEARCH_ESTIMATED_USD_PER_ITEM.low.toFixed(2);
  const high = RESEARCH_ESTIMATED_USD_PER_ITEM.high.toFixed(3);

  return (
    <section className="flex flex-col gap-4">
      <AdminPageHeader
        surface="agents"
        title={t("title")}
        lede={t("lede")}
        facts={[t("factsDaily", { count: RESEARCH_DAILY_ITEM_LIMIT }), t("factsCost", { low, high })]}
      />

      <div className="ui grid gap-4 md:grid-cols-2">
        <SettingsBlock
          id="agent-research"
          title={t("researchTitle")}
          body={
            <>
              <p className="m-0">{t("researchBody")}</p>
              <p className="m-0 mt-2">
                {t("researchLimits", { perRequest: RESEARCH_MAX_ITEMS_PER_REQUEST, daily: RESEARCH_DAILY_ITEM_LIMIT, low, high })}
              </p>
            </>
          }
        >
          {mayOpen(identity, surface("intake")) ? (
            <Link href={surface("intake").href} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("openIntake")}
            </Link>
          ) : null}
          <Link href={surface("refresh").href} className={buttonVariants({ variant: "outline", size: "sm" })}>
            {t("openRefresh")}
          </Link>
        </SettingsBlock>

        <SettingsBlock id="agent-intake" title={t("intakeTitle")} body={t("intakeBody")}>
          {can(identity, IMPORT_PERMISSION) ? (
            <Link href="/admin/intake/imports/new" className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("openImport")}
            </Link>
          ) : null}
        </SettingsBlock>
      </div>

      <section id="research-budget" aria-labelledby="research-budget-heading" className="ui flex flex-col gap-2">
        <h3 id="research-budget-heading" className="m-0 font-heading text-lg font-medium uppercase">
          {t("budgetTitle")}
        </h3>
        {/* A director reads the same in the grant form's own lede. */}
        {!canGrant ? (
          <>
            <p className="m-0 max-w-[72ch] text-sm text-muted-foreground">{t("budgetLede", { daily: RESEARCH_DAILY_ITEM_LIMIT })}</p>
            <p className="m-0 max-w-[72ch] text-sm">{t("budgetDirectorsOnly")}</p>
          </>
        ) : candidates === null ? (
          <EmptyState tone="bad">{t("budgetUnreadable")}</EmptyState>
        ) : candidates.length === 0 ? (
          <EmptyState>{t("budgetNobody")}</EmptyState>
        ) : (
          <AllowanceGrant candidates={candidates} grant={grantSetupAllowance} />
        )}
      </section>
    </section>
  );
}

/**
 * Who may be granted a setup allowance (bulk intake spec §4.2): everyone who
 * may add equipment, with what they hold now. A read that fails is null, said
 * as such, never an empty list.
 */
async function loadCandidates(): Promise<AllowanceCandidate[] | null> {
  try {
    const users = await listUsers();
    const researchers = users.filter((person) => !person.banned && can({ role: person.role }, "tools.add"));
    const grants = await listActiveAllowances(researchers.map((person) => person.id));
    return researchers.map((person) => {
      const own = grants.filter((grant) => grant.userId === person.id);
      return {
        id: person.id,
        name: person.name,
        email: person.email,
        activeExtra: own.reduce((sum, grant) => sum + grant.extraItems, 0),
        activeUntil: own.length > 0 ? new Date(Math.max(...own.map((grant) => grant.expiresAt.getTime()))).toISOString() : null,
      };
    });
  } catch (err) {
    console.error("[admin/settings/ai-agents] could not read the research budget", err);
    return null;
  }
}
