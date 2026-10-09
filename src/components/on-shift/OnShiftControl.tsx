"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SetShiftAction, ShiftError } from "../../app/account/shift-result";
import type { AdminGateError } from "../../lib/admin/action-result";
import { DEFAULT_SHIFT_END, isShiftOn, labClockTime } from "../../lib/on-shift/time";
import { ReviewNote } from "../system/review/ReviewCard";
import { useHydrated } from "../admin/use-hydrated";
import { useRefreshNudge } from "../admin/use-refresh-nudge";

/**
 * **On shift** for a staff member (on-shift spec 2026-10-07 §6): mark
 * yourself on shift until a time today, change that time, or end the shift
 * now. On the admin overview and on `/account`, the same control and the same
 * server action (`setMyShift`), which only ever changes the caller's own row.
 *
 * The time is lab time: the form sends "HH:MM" and the server reads it as
 * today in `LAB_TIMEZONE`, so the browser's own timezone never moves it. The
 * default is the end of today. The confirmed end comes back from the action
 * and is shown from there, so the line is right even before the page's
 * re-render lands; a refusal keeps the time typed and says why.
 *
 * `shownAs` is how students will see this person ("Alex M."). Null means the
 * account's name is a placeholder (the address): marking yourself still
 * works, but nobody is shown, and the control says so with a link to fix it.
 */

export interface OnShiftControlProps {
  /** The caller's current shift end (ISO), or null when they are not on shift. */
  endsAt: string | null;
  /** "Alex M.", or null when the account has no name to show. */
  shownAs: string | null;
  /** The lab's timezone, for showing the end time. */
  timeZone: string;
  /** Where the name is changed, when there is none to show. */
  nameHref: string;
  action: SetShiftAction;
}

export function OnShiftControl({ endsAt: initialEndsAt, shownAs, timeZone, nameHref, action }: OnShiftControlProps) {
  const t = useTranslations("admin.onShift");
  const te = useTranslations("admin.errors");
  const format = useFormatter();
  const hydrated = useHydrated();
  const nudge = useRefreshNudge();
  const id = useId();
  const [endsAt, setEndsAt] = useState<string | null>(isShiftOn(initialEndsAt) ? initialEndsAt : null);
  const [until, setUntil] = useState(endsAt ? labClockTime(endsAt, timeZone) : DEFAULT_SHIFT_END);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ShiftError | AdminGateError | null>(null);

  const onShift = endsAt !== null;
  const endTime = (iso: string) => format.dateTime(new Date(iso), { hour: "numeric", minute: "2-digit", timeZone });

  async function submit(input: Parameters<SetShiftAction>[0]) {
    setPending(true);
    setError(null);
    try {
      const result = await action(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEndsAt(result.endsAt);
      if (!result.endsAt) setUntil(DEFAULT_SHIFT_END);
      nudge();
    } catch {
      setError("failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div data-slot="on-shift-control" data-on-shift={onShift ? "true" : "false"} className="flex flex-col gap-3">
      <p role="status" className="text-sm font-medium">
        {endsAt ? t("onUntil", { time: endTime(endsAt) }) : t("off")}
      </p>
      {shownAs ? (
        <p className="text-sm text-muted-foreground">{t("shownAs", { name: shownAs })}</p>
      ) : (
        <ReviewNote tone="warn">
          {t.rich("noName", { link: (chunks) => <Link href={nameHref} className="underline">{chunks}</Link> })}
        </ReviewNote>
      )}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submit({ onShift: true, until });
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-until`} className="font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase">
            {t("untilLabel")}
          </label>
          <Input
            id={`${id}-until`}
            type="time"
            required
            value={until}
            disabled={pending}
            onChange={(event) => setUntil(event.target.value)}
            className="w-36"
          />
        </div>
        <Button type="submit" size="sm" variant={onShift ? "outline" : "default"} disabled={!hydrated || pending}>
          {onShift ? t("change") : t("start")}
        </Button>
        {onShift ? (
          <Button type="button" size="sm" variant="ghost" disabled={!hydrated || pending} onClick={() => void submit({ onShift: false })}>
            {t("end")}
          </Button>
        ) : null}
      </form>
      {error ? (
        <ReviewNote role="alert" tone="bad">
          {te(error)}
        </ReviewNote>
      ) : null}
    </div>
  );
}
