import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button, buttonVariants } from "@/components/ui/button";
import { AdminNotice } from "../../../../../components/admin/AdminNotice";
import { AdminPageHeader } from "../../../../../components/admin/AdminPageHeader";
import { RowStatus } from "../../../../../components/admin/RowStatus";
import { ToolSkillView } from "../../../../../components/admin/skills/ToolSkillView";
import { ToolSkillWriteButton } from "../../../../../components/admin/skills/ToolSkillWriteButton";
import { EmptyState } from "../../../../../components/system/EmptyState";
import { modelIdFor } from "../../../../../lib/ai/models";
import { resolveIdentityFromHeaders } from "../../../../../lib/auth/identity";
import { can } from "../../../../../lib/auth/permissions";
import { findToolByIdOrSlug } from "../../../../../lib/data/catalog";
import { getDb } from "../../../../../lib/db/client";
import { isoDay } from "../../../../../lib/iso-day";
import { skillInputHash } from "../../../../../lib/skills/hash";
import { assembleSkillInputs, hasSkillMaterial } from "../../../../../lib/skills/inputs";
import { SKILL_PROMPT_VERSION } from "../../../../../lib/skills/prompt";
import { readSkillHistory } from "../../../../../lib/skills/read";
import { skillsAfterResearch } from "../../../../../lib/skills/setting";
import { writeSkill } from "./actions";

/**
 * `/admin/inventory/<slug>/skill` — one tool's **tool skill** (tool skills
 * spec 2026-10-07 §6): the cited operating guide AI assistants read for it in
 * the chat and over MCP. `tools.edit`, like the editor that links here.
 *
 * - The current skill (its latest `ready` row), rendered, with its sources and
 *   what the checks removed; the facts line says its version, date, model,
 *   cost, trigger and whether it is up to date (the hash of what it would be
 *   written from now, against the one it was).
 * - **Write skill / Rewrite skill** starts a run (`skills.write`); the page
 *   then polls until the new attempt shows.
 * - A failed latest attempt is said above the skill it did not replace.
 *
 * Drafts included (staff review a skill before the tool is published);
 * archived tools are not found. Uncached: a review page is a picture of now.
 * A read that fails says so.
 */

export const metadata = {
  title: "Tool skill",
};

export default async function AdminToolSkillPage({ params }: { params: Promise<{ tool: string }> }) {
  const t = await getTranslations("admin.skills");
  const identity = await resolveIdentityFromHeaders();
  if (!can(identity, "tools.edit")) return <AdminNotice kind="forbidden" />;

  const { tool: key } = await params;
  const db = await getDb();
  const tool = await findToolByIdOrSlug(decodeURIComponent(key), { db, includeDrafts: true }).catch(() => null);
  if (!tool) {
    return (
      <section className="flex flex-col gap-4">
        <AdminPageHeader surface="inventory" item title={t("title")} />
        <EmptyState
          action={
            <Button asChild size="sm">
              <Link href="/admin/inventory">{t("backToInventory")}</Link>
            </Button>
          }
        >
          {t("notFound")}
        </EmptyState>
      </section>
    );
  }

  let history: Awaited<ReturnType<typeof readSkillHistory>>;
  let inputs: Awaited<ReturnType<typeof assembleSkillInputs>>;
  let afterResearch: boolean;
  try {
    [history, inputs, afterResearch] = await Promise.all([readSkillHistory(db, tool.id), assembleSkillInputs(db, tool.id), skillsAfterResearch(db)]);
  } catch (err) {
    console.error("[admin/inventory/skill] could not read the tool skill", err);
    return (
      <section className="flex flex-col gap-4">
        <AdminPageHeader surface="inventory" item title={tool.name} lede={t("lede")} />
        <EmptyState tone="bad">{t("unreadable")}</EmptyState>
      </section>
    );
  }

  const { current, latest } = history;
  const fresh = current && inputs ? isFresh(inputs, current.inputHash) : null;
  const failedSince = latest && latest.status === "failed" && (!current || latest.version > current.version) ? latest : null;

  return (
    <section className="flex flex-col gap-4">
      <AdminPageHeader
        surface="inventory"
        item
        title={tool.name}
        lede={t("lede")}
        facts={
          current
            ? [
                t("factsVersion", { version: current.version }),
                t("factsWritten", { date: isoDay(current.generatedAt) }),
                current.model,
                t("factsCost", { cost: current.costUsd.toFixed(4) }),
                t(`trigger.${current.trigger}`),
                fresh === true ? t("factsUpToDate") : fresh === false ? t("factsOutOfDate") : null,
              ]
            : [t("factsNone")]
        }
        actions={
          <span className="flex flex-wrap items-start gap-2">
            <ToolSkillWriteButton toolId={tool.id} hasSkill={Boolean(current)} latestVersion={latest?.version ?? null} write={writeSkill} />
            <Link href={`/tools/${tool.slug}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("openTool")}
            </Link>
          </span>
        }
      />

      <p className="m-0 max-w-[78ch] text-sm text-muted-foreground" data-slot="tool-skill-setting">
        {afterResearch ? t("afterResearchOn") : t("afterResearchOff")}
      </p>

      {failedSince ? (
        <RowStatus tone="warn" as="p" role="status">
          {t("lastFailed", { date: isoDay(failedSince.createdAt.toISOString()), reason: failedSince.error ?? "—" })}
        </RowStatus>
      ) : null}
      {fresh === false ? (
        <RowStatus tone="warn" as="p" role="status">
          {t("outOfDate")}
        </RowStatus>
      ) : null}

      {current ? (
        <ToolSkillView content={current.content} sources={current.sources} removed={current.sections?.removed ?? []} />
      ) : (
        <EmptyState>{inputs && !hasSkillMaterial(inputs) ? t("nothingToWrite") : t("empty")}</EmptyState>
      )}
    </section>
  );
}

/** Whether a rewrite now would read what the current skill was written from. Unknown (null) when the model setting is malformed. */
function isFresh(inputs: NonNullable<Awaited<ReturnType<typeof assembleSkillInputs>>>, storedHash: string): boolean | null {
  try {
    return skillInputHash(inputs, { model: modelIdFor("skillWrite"), promptVersion: SKILL_PROMPT_VERSION }) === storedHash;
  } catch {
    return null;
  }
}
