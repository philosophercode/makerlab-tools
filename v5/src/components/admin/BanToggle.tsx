"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  AdminActionError,
  AdminActionResult,
  AdminActionWarning,
} from "../../app/admin/users/action-result";

/**
 * Ban and unban, beside the role select on `/admin/users` (spec §5.2).
 *
 * Its own file rather than a second control inside `RoleSelect`: the two do
 * different things to different columns, and a component that owned both would
 * have two pending states and two failure states braided together.
 *
 * The reason field is optional and only offered when banning. It is stored on
 * `user.ban_reason` and is what the person is told when they try to sign in
 * again, so an empty one is a worse answer than a short one — but not worth
 * blocking on, since a ban that has to be justified before it can be applied is
 * a ban that happens in the database instead.
 *
 * As in `RoleSelect`, the action arrives as a prop and the server checks the
 * permission again: hiding or disabling this button is presentation (§8).
 */

export interface BanToggleProps {
  userId: string;
  personName: string;
  banned: boolean;
  /** Why this row cannot be banned, or null when it can. */
  disabledReason?: AdminActionError | null;
  /** The `setUserBanned` server action, passed down by the page. */
  action: (input: {
    userId: string;
    banned: boolean;
    reason?: string;
  }) => Promise<AdminActionResult>;
}

export function BanToggle({
  userId,
  personName,
  banned,
  disabledReason = null,
  action,
}: BanToggleProps) {
  const t = useTranslations("admin");
  const [pending, setPending] = useState(false);
  const [current, setCurrent] = useState(banned);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<AdminActionError | null>(null);
  // As in `RoleSelect`: the ban landed, the audit trail did not record it, and
  // the button must keep showing the state the database now holds.
  const [warning, setWarning] = useState<AdminActionWarning | null>(null);

  // A lift is never refused for these reasons — they are all about *removing*
  // someone's access, and restoring it cannot lock anybody out.
  const locked = Boolean(disabledReason) && !current;

  /** Not in a `useTransition`, for the reason `RoleSelect` explains. */
  async function handleToggle() {
    const next = !current;
    setCurrent(next);
    setError(null);
    setWarning(null);
    setPending(true);

    try {
      const result = await action({
        userId,
        banned: next,
        ...(next && reason.trim() ? { reason: reason.trim() } : {}),
      });
      if (result.ok) {
        if (next) setReason("");
        setWarning(result.warning ?? null);
        return;
      }
      setCurrent(!next);
      setError(result.error);
    } catch {
      setCurrent(!next);
      setError("failed");
    } finally {
      setPending(false);
    }
  }

  const note = error ?? (locked ? disabledReason : null);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!current ? (
        <Input
          type="text"
          className="h-7 w-auto max-w-[22ch] min-w-[14ch] text-table"
          value={reason}
          maxLength={200}
          disabled={locked || pending}
          placeholder={t("banReasonPlaceholder")}
          aria-label={t("banReasonFor", { name: personName })}
          onChange={(event) => setReason(event.target.value)}
        />
      ) : null}
      <Button
        type="button"
        variant={current ? "quiet" : "destructive"}
        size="sm"
        disabled={locked || pending}
        onClick={() => void handleToggle()}
      >
        {current ? t("liftBanFor", { name: personName }) : t("banFor", { name: personName })}
      </Button>
      <span
        className={cn(
          "basis-full text-xs leading-snug text-muted-foreground empty:hidden",
          error ? "text-bad" : warning ? "text-warn" : null
        )}
        role="status"
      >
        {pending ? t("saving") : null}
        {!pending && warning ? t(`warnings.${warning}`) : null}
        {!pending && note ? t(`errors.${note}`) : null}
      </span>
    </div>
  );
}
