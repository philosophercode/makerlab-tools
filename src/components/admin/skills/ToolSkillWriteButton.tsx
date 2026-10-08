"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { WriteToolSkillAction } from "../../../app/admin/inventory/[tool]/skill/action-result";
import { SKILL_POLL_FOR_MS, SKILL_POLL_INTERVAL_MS } from "../../../lib/skills/limits";
import { AsyncButton } from "../../system/AsyncButton";
import { RowStatus } from "../RowStatus";
import { useHydrated } from "../use-hydrated";
import { usePoll } from "../use-poll";

/**
 * **Write skill / Rewrite skill** on a tool's skill page (tool skills spec
 * 2026-10-07 §6). The action only starts the run; the skill is written in the
 * background in a minute or two. So once it has started, the page is
 * refreshed every few seconds — never while the tab is hidden — until the
 * tool's latest attempt changes (a new skill, or a failure the page then
 * shows), or for three minutes at most. The action arrives as a prop, like
 * every admin island's.
 */
export interface ToolSkillWriteButtonProps {
  toolId: string;
  hasSkill: boolean;
  /** The tool's latest attempt's version (ready or failed), null when it has none. */
  latestVersion: number | null;
  write: WriteToolSkillAction;
}

export function ToolSkillWriteButton({ toolId, hasSkill, latestVersion, write }: ToolSkillWriteButtonProps) {
  const t = useTranslations("admin.skills");
  const tAdmin = useTranslations("admin");
  const router = useRouter();
  const hydrated = useHydrated();
  /** The latest version when the run was started, and when; null when nothing is awaited. */
  const [awaiting, setAwaiting] = useState<{ from: number | null; since: number } | null>(null);
  // Derived, not set in an effect: the wait is over once the page shows a newer attempt.
  const waiting = awaiting !== null && latestVersion === awaiting.from;

  usePoll(
    () => {
      if (!awaiting || Date.now() - awaiting.since > SKILL_POLL_FOR_MS) {
        setAwaiting(null);
        return;
      }
      router.refresh();
    },
    SKILL_POLL_INTERVAL_MS,
    waiting
  );

  return (
    <span className="inline-flex flex-col items-start gap-1" data-slot="tool-skill-write">
      <AsyncButton
        size="sm"
        disabled={!hydrated || waiting}
        doneLabel={t("started")}
        onRun={async () => {
          const result = await write({ toolId });
          if (!result.ok) return tAdmin(`errors.${result.error}`);
          setAwaiting({ from: latestVersion, since: Date.now() });
          return true;
        }}
      >
        {hasSkill ? t("rewrite") : t("write")}
      </AsyncButton>
      {waiting ? <RowStatus tone="muted">{t("writing")}</RowStatus> : null}
    </span>
  );
}
