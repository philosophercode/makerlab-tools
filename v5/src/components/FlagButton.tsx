"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
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
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "./system/Field";
import { RowStatus } from "./admin/RowStatus";

/**
 * "Report a correction" — a quiet text control at the foot of the tool page
 * that opens a short form in a `Dialog` (design spec 2026-07-29 §6; UI system
 * phase 5b, DESIGN.md §8.8: a decision gets a dialog). Radix gives the focus
 * trap, Escape and focus return; the fields are `Field` + `NativeSelect` /
 * `Textarea` / `Input`, the actions `Button`s.
 *
 * The confirmation replaces the form in place rather than firing a toast —
 * toasts vanish before they are read. On failure the typed input is kept, and
 * closing after a failure keeps it too; only a report that was sent resets.
 *
 * This is a client component, so it cannot import the server-only `flags`
 * capability; `FIELD_OPTIONS` mirrors `FLAG_FIELDS` there and `FlagButton.test.tsx`
 * asserts the two stay in step.
 */

const FIELD_OPTIONS = [
  "description",
  "image",
  "name",
  "category",
  "location",
  "materials",
  "safety_info",
] as const;

type FieldOption = (typeof FIELD_OPTIONS)[number];

/** Mirrors MAX_FLAG_TEXT in lib/capabilities/flags.ts (spec §8). */
const MAX_TEXT = 2_000;
const MAX_REPORTER = 200;

/** Error `code`s from `/api/flags` mapped to the message key shown to students. */
const ERROR_MESSAGE_KEY: Record<string, "errorInvalid" | "errorRateLimited" | "errorFailed"> = {
  invalid_input: "errorInvalid",
  unknown_tool: "errorInvalid",
  rate_limited: "errorRateLimited",
  not_configured: "errorFailed",
  write_failed: "errorFailed",
};

interface FlagButtonProps {
  /** Id of the tool being reported. */
  toolId: string;
  /** Pre-selected field, when the control is opened from a specific one. */
  field?: FieldOption;
}

export function FlagButton({ toolId, field: initialField = "description" }: FlagButtonProps) {
  const t = useTranslations("flag");
  const id = useId();

  const [open, setOpen] = useState(false);
  const [field, setField] = useState<FieldOption>(initialField);
  const [description, setDescription] = useState("");
  const [suggestion, setSuggestion] = useState("");
  const [reporter, setReporter] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<"errorInvalid" | "errorRateLimited" | "errorFailed" | null>(null);
  const [sent, setSent] = useState(false);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) return;
    // Reset only after a successful report; a failed one keeps what was typed.
    if (sent) {
      setSent(false);
      setField(initialField);
      setDescription("");
      setSuggestion("");
      setReporter("");
    }
    setErrorKey(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!description.trim() || submitting) return;

    setErrorKey(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool_id: toolId,
          field_flagged: field,
          issue_description: description.trim(),
          suggested_fix: suggestion.trim() || undefined,
          reporter: reporter.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { code?: string } | null;
        setErrorKey(ERROR_MESSAGE_KEY[data?.code || ""] || "errorFailed");
        return;
      }

      setSent(true);
    } catch {
      setErrorKey("errorFailed");
    } finally {
      setSubmitting(false);
    }
  }

  const ids = {
    field: `${id}-field`,
    description: `${id}-description`,
    suggestion: `${id}-suggestion`,
    reporter: `${id}-reporter`,
  };

  return (
    <div className="ui mx-auto mb-10 w-full max-w-[1200px] px-4 sm:px-8">
      <Dialog open={open} onOpenChange={onOpenChange}>
        {/* A Radix trigger, so closing returns focus here. */}
        <DialogTrigger asChild>
          <Button variant="link" className="h-auto px-0 py-1 font-mono text-label text-muted-foreground normal-case underline hover:text-foreground">
            {t("trigger")}
          </Button>
        </DialogTrigger>
        <DialogContent closeLabel={t("close")} className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogHeader>
            <p className="font-mono text-label tracking-[0.08em] text-muted-foreground uppercase">{t("eyebrow")}</p>
            <DialogTitle>{sent ? t("sentTitle") : t("title")}</DialogTitle>
            <DialogDescription>{sent ? t("sentBody") : t("lede")}</DialogDescription>
          </DialogHeader>

          {sent ? (
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="default">{t("close")}</Button>
              </DialogClose>
            </DialogFooter>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
              <Field id={ids.field} label={t("fieldLabel")}>
                <NativeSelect
                  id={ids.field}
                  value={field}
                  onChange={(event) => setField(event.target.value as FieldOption)}
                  className="w-full"
                >
                  {FIELD_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {t(`fields.${option}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>

              <Field id={ids.description} label={t("descriptionLabel")}>
                <Textarea
                  id={ids.description}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={t("descriptionPlaceholder")}
                  maxLength={MAX_TEXT}
                  rows={4}
                  required
                />
              </Field>

              <Field id={ids.suggestion} label={t("suggestionLabel")}>
                <Textarea
                  id={ids.suggestion}
                  value={suggestion}
                  onChange={(event) => setSuggestion(event.target.value)}
                  maxLength={MAX_TEXT}
                  rows={2}
                />
              </Field>

              <Field id={ids.reporter} label={t("nameLabel")}>
                <Input
                  id={ids.reporter}
                  type="text"
                  value={reporter}
                  onChange={(event) => setReporter(event.target.value)}
                  maxLength={MAX_REPORTER}
                />
              </Field>

              {errorKey ? (
                <RowStatus tone="bad" role="alert">
                  {t(errorKey)}
                </RowStatus>
              ) : null}

              <DialogFooter>
                <DialogClose asChild>
                  <Button>{t("cancel")}</Button>
                </DialogClose>
                <Button type="submit" variant="default" disabled={!description.trim() || submitting}>
                  {submitting ? t("submitting") : t("submit")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
