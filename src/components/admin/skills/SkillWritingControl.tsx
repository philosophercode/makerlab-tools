"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { SetSkillWritingAction } from "../../../app/admin/settings/ai-agents/action-result";
import { AsyncButton } from "../../system/AsyncButton";
import { useHydrated } from "../use-hydrated";
import { useRefreshNudge } from "../use-refresh-nudge";

/**
 * "Write a tool skill after research", **Turn on / Turn off** (tool skills
 * spec 2026-10-07 §6), for a director on Settings › AI agents. One button that
 * flips the setting through `skills.set_after_research` (which checks
 * `users.manage` again), then refreshes the page so its state line says the
 * new value. A button rather than a save-on-change switch, so hydration can
 * never replay a stale change; disabled until hydrated all the same.
 */
export interface SkillWritingControlProps {
  on: boolean;
  set: SetSkillWritingAction;
}

export function SkillWritingControl({ on, set }: SkillWritingControlProps) {
  const t = useTranslations("admin.agents");
  const tAdmin = useTranslations("admin");
  const router = useRouter();
  const nudge = useRefreshNudge();
  const hydrated = useHydrated();

  return (
    <AsyncButton
      variant="outline"
      size="sm"
      disabled={!hydrated}
      doneLabel={t("skillsSaved")}
      data-slot="skill-writing-toggle"
      onRun={async () => {
        const result = await set({ afterResearch: !on });
        if (!result.ok) return tAdmin(`errors.${result.error}`);
        router.refresh();
        nudge();
        return true;
      }}
    >
      {on ? t("skillsTurnOff") : t("skillsTurnOn")}
    </AsyncButton>
  );
}
