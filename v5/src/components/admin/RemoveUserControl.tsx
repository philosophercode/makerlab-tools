"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type {
  AdminActionError,
  AdminActionWarning,
  RemoveUserAction,
  RemoveUserResult,
} from "../../app/admin/users/action-result";
import { useHydrated } from "./use-hydrated";

/**
 * **Remove** on a row of `/admin/users` (auth spec amendment 2026-09-25,
 * "Remove a person, and block an address"). It replaced `BanToggle`.
 *
 * **It asks first, inline — never a modal** (UI system spec §6): the button
 * opens a short confirmation under the row that says exactly what happens —
 * access gone, account deleted, reports and history kept — with the optional
 * "Also block this email from signing up again" and, when ticked, a reason.
 * Only the confirmation's own button sends anything.
 *
 * A row that cannot be removed — yourself, an address on the super-admin
 * floor, the last director — shows the button disabled with the reason under
 * it, before anybody clicks. That is presentation: `removeUser` derives all
 * three again before it writes (§8).
 *
 * **It never claims a removal that did not happen.** A refusal keeps the row
 * and shows the reason; only an `ok` answer calls `onRemoved`, which takes the
 * row off the roster and says so. Like `RoleSelect`, it is disabled until
 * hydrated, and the action arrives as a prop so the server stays the control.
 */

export interface RemoveUserControlProps {
  userId: string;
  personName: string;
  email: string;
  /** Why this row cannot be removed, or null when it can. */
  disabledReason?: AdminActionError | null;
  /** The `removeUser` server action, passed down by the page. */
  action: RemoveUserAction;
  /** Called once the server has removed them. */
  onRemoved?: (result: Extract<RemoveUserResult, { ok: true }>) => void;
}

export function RemoveUserControl({
  userId,
  personName,
  email,
  disabledReason = null,
  action,
  onRemoved,
}: RemoveUserControlProps) {
  const t = useTranslations("admin");
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [block, setBlock] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AdminActionError | null>(null);
  const [warning, setWarning] = useState<AdminActionWarning | null>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const promptRef = useRef<HTMLParagraphElement>(null);
  const wasOpen = useRef(false);
  const blockId = useId();

  const locked = Boolean(disabledReason);

  // Opening moves focus to the question, so a screen reader reads it before
  // the buttons; closing without removing returns it to the button.
  useEffect(() => {
    if (open) promptRef.current?.focus();
    else if (wasOpen.current) openerRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  function cancel() {
    setOpen(false);
    setBlock(false);
    setReason("");
    setError(null);
  }

  async function confirm() {
    setPending(true);
    setError(null);
    setWarning(null);
    try {
      const result = await action({
        userId,
        block,
        ...(block && reason.trim() ? { reason: reason.trim() } : {}),
      });
      if (result.ok) {
        setWarning(result.warning ?? null);
        onRemoved?.(result);
        return;
      }
      setError(result.error);
    } catch {
      setError("failed");
    } finally {
      setPending(false);
    }
  }

  const note = error ?? (locked ? disabledReason : null);

  return (
    <div className="flex flex-col gap-1.5">
      {!open ? (
        <Button
          ref={openerRef}
          type="button"
          variant="destructive"
          size="sm"
          className="self-start"
          disabled={locked || !hydrated}
          aria-label={t("removeFor", { name: personName })}
          onClick={() => setOpen(true)}
        >
          {t("remove")}
        </Button>
      ) : (
        <div
          role="group"
          aria-label={t("removeFor", { name: personName })}
          className="flex max-w-[48ch] flex-col gap-2 border border-destructive/60 p-2.5"
        >
          <p ref={promptRef} tabIndex={-1} className="m-0 text-sm leading-snug outline-none">
            {t("removeConfirm", { name: personName })}
          </p>
          <div className="flex items-center gap-2">
            <Checkbox
              id={blockId}
              checked={block}
              disabled={pending}
              onCheckedChange={(value) => setBlock(value === true)}
            />
            <label htmlFor={blockId} className="text-sm">
              {t("removeBlock")}
            </label>
          </div>
          {block ? (
            <Input
              type="text"
              className="h-7 text-table"
              value={reason}
              maxLength={200}
              disabled={pending}
              placeholder={t("removeBlockReason")}
              aria-label={t("removeBlockReasonFor", { email })}
              onChange={(event) => setReason(event.target.value)}
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="destructive" size="sm" disabled={pending} onClick={() => void confirm()}>
              {t("removeConfirmButton", { name: personName })}
            </Button>
            <Button type="button" variant="quiet" size="sm" disabled={pending} onClick={cancel}>
              {t("removeCancel")}
            </Button>
          </div>
        </div>
      )}
      <span
        className={cn(
          "text-xs leading-snug text-muted-foreground empty:hidden",
          error ? "text-bad" : warning ? "text-warn" : null
        )}
        role="status"
      >
        {pending ? t("removing") : null}
        {!pending && warning ? t(`warnings.${warning}`) : null}
        {!pending && note ? t(`errors.${note}`) : null}
      </span>
    </div>
  );
}
