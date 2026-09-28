"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { AdminActionError } from "../../app/admin/users/action-result";

/**
 * Why a People-page control is disabled, said in one or two words
 * ("Protected", "Last super admin", "Your account") instead of a sentence in
 * every row.
 *
 * The full reason (`admin.errors.<reason>`) is still there twice over: in the
 * tooltip, for a sighted pointer or keyboard user (the badge is focusable),
 * and in a visually hidden element whose `id` the disabled control points at
 * with `aria-describedby` — a screen reader hears the reason on the control
 * itself, whether or not anyone opens the tooltip.
 */

/** The reasons that have a short label (`admin.locks.<reason>`). */
export type LockReason = Extract<AdminActionError, "protected_floor" | "last_super_admin" | "self_remove">;

export function isLockReason(reason: AdminActionError | null | undefined): reason is LockReason {
  return reason === "protected_floor" || reason === "last_super_admin" || reason === "self_remove";
}

export interface LockNoteProps {
  reason: LockReason;
  /** The hidden explanation's id, for the control's `aria-describedby`. */
  descriptionId: string;
}

export function LockNote({ reason, descriptionId }: LockNoteProps) {
  const t = useTranslations("admin");
  const explanation = t(`errors.${reason}`);
  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge tabIndex={0} aria-describedby={descriptionId} data-testid="lock-note" className="cursor-help">
              {t(`locks.${reason}`)}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>{explanation}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <span id={descriptionId} className="sr-only">
        {explanation}
      </span>
    </>
  );
}
