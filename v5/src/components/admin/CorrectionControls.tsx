"use client";

import { useTranslations } from "next-intl";
import { FEEDBACK_STATUS } from "../../lib/db/schema/vocabulary";
import type { SetCorrectionStatusAction } from "../../app/admin/corrections/action-result";
import { RowStatus } from "./RowStatus";
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
      className="admin-correction-controls"
      role="group"
      aria-label={t("statusFor", { tool: toolName })}
    >
      <span className={`admin-state is-${row.value}`}>{t(`status.${row.value}`)}</span>

      {FEEDBACK_STATUS.filter((option) => option !== row.value).map((option) => (
        <button
          key={option}
          type="button"
          className="admin-button"
          disabled={row.pending}
          onClick={() => void row.run(option, () => action({ feedbackId, status: option }))}
        >
          {t(`setStatus.${option}`)}
        </button>
      ))}

      <RowStatus
        pending={row.pending}
        saved={row.saved}
        error={row.error}
        warning={row.warning}
      />
    </div>
  );
}
