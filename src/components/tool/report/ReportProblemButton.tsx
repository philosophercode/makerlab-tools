"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Camera, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ToolStatus } from "../../catalog-types";
import { RowStatus } from "../../admin/RowStatus";
import { Field, hintId } from "../../system/Field";
import { FROSTED } from "../../system/frosted";
import { TOOL_STATUS_KEY } from "../../ToolCard";
import {
  QUICK_REPORT_TEXT_MAX,
  QUICK_REPORT_TEXT_MIN,
  QUICK_REPORT_TRAP_FIELD,
} from "../../../lib/maintenance/quick-report-limits";
import { useReportPhoto } from "./use-report-photo";

/**
 * "Report a problem" (quick report spec §6): a button that opens the short
 * form in a `Dialog`. One box, "Tell us what's wrong with this machine", an
 * optional photo, and the unit: preselected when the page was reached from a
 * unit's label, a choice when the tool has several, nothing to choose when it
 * has one. `POST /api/report` does the rest (the AI's guess, the ticket), and
 * the student sees a plain confirmation with the ticket's short reference.
 *
 * Like Report a correction (`FlagButton`): the confirmation replaces the form
 * in place, a failure keeps what was typed (closing keeps it too), and only a
 * report that was sent resets. The state lives here, outside the dialog's
 * content, because Radix unmounts the content when it closes.
 */

export interface ReportUnit {
  id: string;
  name: string;
  status: ToolStatus;
}

export interface ReportProblemButtonProps {
  toolSlug: string;
  toolName: string;
  units: readonly ReportUnit[];
  /** The unit a scanned label named, preselected. */
  initialUnitId?: string | null;
  /** The button's words. */
  label: string;
  variant?: "default" | "quiet" | "outline";
  className?: string;
}

type ErrorKey = "errorInvalid" | "errorRateLimited" | "errorFailed";

const ERROR_KEY: Record<string, ErrorKey> = {
  invalid_input: "errorInvalid",
  unknown_tool: "errorFailed",
  rate_limited: "errorRateLimited",
  write_failed: "errorFailed",
};

const PHOTO_ERROR_KEY = {
  unavailable: "photoUnavailable",
  failed: "photoFailed",
  notImage: "photoNotImage",
} as const;

/** Nothing to choose: the unit is the only one, or there is none. */
function defaultUnit(units: readonly ReportUnit[], initialUnitId: string | null | undefined): string {
  if (initialUnitId && units.some((unit) => unit.id === initialUnitId)) return initialUnitId;
  return units.length === 1 ? units[0].id : "";
}

export function ReportProblemButton({
  toolSlug,
  toolName,
  units,
  initialUnitId = null,
  label,
  variant = "default",
  className,
}: ReportProblemButtonProps) {
  const t = useTranslations("report");
  const tStatus = useTranslations("gallery.status");
  const id = useId();
  const ids = { text: `${id}-text`, photo: `${id}-photo`, trap: `${id}-trap` };

  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [unitId, setUnitId] = useState(() => defaultUnit(units, initialUnitId));
  const [trap, setTrap] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<ErrorKey | null>(null);
  const [sent, setSent] = useState<{ ref: string; unit: string | null } | null>(null);
  const photo = useReportPhoto();
  // When the form opened: the server refuses a report sent faster than a
  // person could write one (the bot check, §8).
  const openedAt = useRef(0);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      openedAt.current = Date.now();
      // A label scanned after the page loaded (client navigation) names its unit.
      if (initialUnitId) setUnitId(defaultUnit(units, initialUnitId));
      return;
    }
    if (sent) {
      setSent(null);
      setText("");
      setTrap("");
      setUnitId(defaultUnit(units, initialUnitId));
      photo.clear();
    }
    setErrorKey(null);
  }

  const trimmed = text.trim();
  const canSend = trimmed.length >= QUICK_REPORT_TEXT_MIN && !submitting && !photo.uploading;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSend) return;
    setErrorKey(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool: toolSlug,
          unit_id: unitId || null,
          text: trimmed,
          photo_attachment_ids: photo.photo ? [photo.photo.id] : [],
          [QUICK_REPORT_TRAP_FIELD]: trap,
          open_ms: Date.now() - openedAt.current,
        }),
      });
      const data = (await res.json().catch(() => null)) as { code?: string; ref?: string; unit?: string | null } | null;
      if (!res.ok || !data?.ref) {
        setErrorKey(ERROR_KEY[data?.code ?? ""] ?? "errorFailed");
        return;
      }
      setSent({ ref: data.ref, unit: data.unit ?? null });
    } catch {
      setErrorKey("errorFailed");
    } finally {
      setSubmitting(false);
    }
  }

  const fromLabel = Boolean(initialUnitId && units.some((unit) => unit.id === initialUnitId));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* A Radix trigger, so closing returns focus here. */}
      <DialogTrigger asChild>
        <Button variant={variant} className={className} data-slot="report-problem">
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent
        closeLabel={t("close")}
        data-slot="quick-report"
        className={cn(FROSTED, "max-h-[calc(100dvh-2rem)] overflow-y-auto")}
      >
        <DialogHeader>
          <p className="font-mono text-label tracking-[0.08em] text-muted-foreground uppercase">{t("eyebrow")}</p>
          <DialogTitle>{sent ? t("sentTitle") : toolName}</DialogTitle>
          <DialogDescription>{sent ? t("sentBody") : t("lede")}</DialogDescription>
        </DialogHeader>

        {sent ? (
          <div className="flex flex-col gap-4" data-slot="quick-report-sent">
            <div className="flex flex-col gap-1 border border-border bg-card px-4 py-3">
              <p className="font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase">{t("refLabel")}</p>
              <p className="font-mono text-2xl font-medium tracking-[0.06em]" data-slot="quick-report-ref">
                {sent.ref}
              </p>
              {sent.unit ? <p className="text-sm text-muted-foreground">{t("sentUnit", { unit: sent.unit })}</p> : null}
            </div>
            <p className="text-sm text-muted-foreground">{t("sentSafety")}</p>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="default">{t("done")}</Button>
              </DialogClose>
            </DialogFooter>
          </div>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
            {units.length > 1 ? (
              <fieldset className="flex min-w-0 flex-col gap-1.5" data-slot="quick-report-units">
                <legend className="mb-1.5 font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase">{t("unitLabel")}</legend>
                <div className="flex flex-wrap gap-1.5">
                  {[...units.map((unit) => ({ value: unit.id, name: unit.name, status: unit.status })), { value: "", name: t("unitNotSure"), status: null }].map(
                    (option) => {
                      const checked = unitId === option.value;
                      const showStatus = option.status === "Offline" || option.status === "In Use";
                      return (
                        <label
                          key={option.value || "not-sure"}
                          className={cn(
                            "relative inline-flex min-h-10 cursor-pointer flex-col items-start justify-center border px-3 py-1.5 text-sm",
                            "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-solid",
                            checked ? "border-foreground bg-foreground text-background" : "border-border hover:border-foreground/40"
                          )}
                        >
                          <input
                            type="radio"
                            name={`${id}-unit`}
                            value={option.value}
                            checked={checked}
                            onChange={() => setUnitId(option.value)}
                            className="sr-only"
                          />
                          <span>{option.name}</span>
                          {showStatus && option.status ? (
                            <span className={cn("font-mono text-micro uppercase", checked ? "text-background/80" : "text-muted-foreground")}>
                              {tStatus(TOOL_STATUS_KEY[option.status])}
                            </span>
                          ) : null}
                        </label>
                      );
                    }
                  )}
                </div>
                {fromLabel ? <p className="text-xs text-muted-foreground">{t("unitFromLabel")}</p> : null}
              </fieldset>
            ) : null}

            <Field id={ids.text} label={t("textLabel")} hint={t("textHint")}>
              <Textarea
                id={ids.text}
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={t("textPlaceholder")}
                maxLength={QUICK_REPORT_TEXT_MAX}
                aria-describedby={hintId(ids.text)}
                rows={5}
                required
                autoFocus
              />
            </Field>

            <div className="flex flex-col gap-2" data-slot="quick-report-photo">
              {photo.photo ? (
                <div className="flex items-center gap-3">
                  {photo.photo.previewUrl ? (
                    // A local object URL for the photo they just took: not a remote image.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo.photo.previewUrl} alt="" className="size-14 border border-border object-cover" />
                  ) : null}
                  <span className="min-w-0 flex-1 truncate text-sm">{photo.photo.name}</span>
                  <Button type="button" variant="ghost" size="sm" onClick={photo.clear}>
                    <X aria-hidden="true" />
                    {t("photoRemove")}
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Button variant="quiet" asChild>
                    <label htmlFor={ids.photo} className={cn(photo.uploading && "pointer-events-none opacity-50")}>
                      <Camera aria-hidden="true" />
                      {photo.uploading ? t("photoUploading") : t("photoAdd")}
                    </label>
                  </Button>
                  <input
                    id={ids.photo}
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    disabled={photo.uploading}
                    onChange={(event) => {
                      void photo.upload(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                  />
                  <span className="text-xs text-muted-foreground">{t("photoHint")}</span>
                </div>
              )}
              {photo.error ? (
                <RowStatus tone="warn" role="status">
                  {t(PHOTO_ERROR_KEY[photo.error])}
                </RowStatus>
              ) : null}
            </div>

            {/* The bot check (§8): a field no person sees or reaches, which a
                form-filling script fills. Visually hidden rather than
                display:none, which some scripts skip. */}
            <div aria-hidden="true" className="sr-only">
              <label htmlFor={ids.trap}>{t("trapLabel")}</label>
              <input
                id={ids.trap}
                name={QUICK_REPORT_TRAP_FIELD}
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={trap}
                onChange={(event) => setTrap(event.target.value)}
              />
            </div>

            {errorKey ? (
              <RowStatus tone="bad" role="alert">
                {t(errorKey)}
              </RowStatus>
            ) : null}

            <p className="bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              <strong className="font-medium text-foreground">{t("nextTitle")}</strong> {t("nextBody")}
            </p>

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button">{t("cancel")}</Button>
              </DialogClose>
              <Button type="submit" variant="default" disabled={!canSend}>
                {submitting ? t("submitting") : t("submit")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
