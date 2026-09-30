"use client";

import { useTranslations } from "next-intl";
import { FEEDBACK_STATUS } from "../../lib/db/schema/vocabulary";
import type { SetCorrectionStatusAction } from "../../app/admin/corrections/action-result";
import { Button } from "@/components/ui/button";
import { StatusGlyph, type StatusTone } from "../system/StatusGlyph";
import { RowStatus, SaveSlot } from "./RowStatus";
import { useRowAction } from "./use-row-action";

/**
 * Triaging one correction (spec §5.6).
 *
 * **Buttons, not a select.** Every other row control in `/admin` picks from a
 * vocabulary with a `<select>`, and this one deliberately does not: a select is
 * open, choose, close — three interactions — and a reviewer working through
 * corrections is making the same small judgement over and over. One button per
 * outcome is one click, and the current status is a badge beside them rather
 * than a value hiding inside a closed control.
 *
 * The button for the status a correction already has is left out rather than
 * disabled: it would be a control that does nothing, and the badge already says
 * where the row is.
 *
 * Optimistic, and a refusal restores the previous status — `useRowAction` owns
 * that contract. The action arrives as a prop and re-checks `feedback.manage`
 * for itself (§8).
 */

export interface CorrectionControlsProps {
  feedbackId: string;
  /** One of `FEEDBACK_STATUS`. */
  status: string;
  /** Names the tool this correction is about, for the group's accessible name. */
  toolName: string;
  action: SetCorrectionStatusAction;
}

export function CorrectionControls({
  feedbackId,
  status,
  toolName,
  action,
}: CorrectionControlsProps) {
  const t = useTranslations("admin.corrections");
  const row = useRowAction<string>(status);

  return (
    <div
      className="flex flex-wrap items-center gap-2 border-t border-rule pt-2"
      role="group"
      aria-label={t("statusFor", { tool: toolName })}
    >
      {/* The status and "Saved" beside it, both in fixed places: the buttons after
          them change with the status, so nothing before them may move (public polish). */}
      <StatusGlyph tone={CORRECTION_STATUS_TONE[row.value] ?? "idle"} label={t(`status.${row.value}`)} className="min-w-24" />
      <SaveSlot pending={row.pending} saved={row.saved} error={row.error} warning={row.warning} />

      {FEEDBACK_STATUS.filter((option) => option !== row.value).map((option) => (
        <Button
          key={option}
          size="xs"
          variant={option === "dismissed" ? "ghost" : "quiet"}
          disabled={row.pending}
          onClick={() => void row.run(option, () => action({ feedbackId, status: option }))}
        >
          {t(`setStatus.${option}`)}
        </Button>
      ))}

      <RowStatus pending={false} saved={false} error={row.error} warning={row.warning} />
    </div>
  );
}

/** A correction's status as a glyph: waiting on you, looked at, done, set aside. */
export const CORRECTION_STATUS_TONE: Record<string, StatusTone> = {
  new: "active",
  reviewed: "warn",
  fixed: "ok",
  dismissed: "muted",
};
