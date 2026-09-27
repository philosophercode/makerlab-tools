"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useHydrated } from "../admin/use-hydrated";

/**
 * One short text value, read as text with a pencil beside it, edited inline —
 * a person's title and name on the People page, your own name on `/account`.
 * Never a modal (UI system spec §6); the same shape as a ticket's resolution
 * (§ "a ticket's resolution is a button until it is wanted").
 *
 * - **Read**: `display(stored)` and a pencil icon button whose accessible name
 *   is `editLabel` ("Edit the title for Ada Lovelace") and whose tooltip is
 *   `editTooltip`. Disabled until hydrated, like every click-to-save control.
 * - **Edit**: a text field (focused), a hint, **Save** and **Cancel**. Escape
 *   cancels; closing returns focus to the pencil.
 * - **It shows what the server stored, not what was typed.** `save` answers
 *   with the stored value (normalised: trimmed, collapsed), and that is what
 *   is shown. A refusal keeps the field open with the reason under it and
 *   nothing changed; a save that never answers is "failed" (Article 4).
 * - A later server render with a different value (somebody else's save)
 *   replaces the shown one — adjusted during render, so the stale value is
 *   never painted.
 *
 * The caller owns the words: every label, and how an error or warning code
 * reads (`describe`), because the codes belong to the action that raised them.
 */

export type InlineSaveResult =
  | { ok: true; value: string | null; warning?: string }
  | { ok: false; error: string };

export interface InlineTextEditorProps {
  /** What the server last stored. Null only for a value that may be empty (a title). */
  value: string | null;
  /** How the stored value reads when not editing. */
  display: (stored: string | null) => ReactNode;
  /** The pencil's accessible name — say whose value it is. */
  editLabel: string;
  /** The pencil's tooltip. */
  editTooltip: string;
  /** The field's accessible name. */
  inputLabel: string;
  placeholder?: string;
  hint?: string;
  maxLength: number;
  /** Writes the draft; answers the stored value. The server action, wrapped. */
  save: (draft: string) => Promise<InlineSaveResult>;
  /** How an error code (`{ ok: false, error }`) or a warning reads. */
  describe: (code: { error: string } | { warning: string }) => string;
  /** Layout of the read state (e.g. a name in a heading row). */
  className?: string;
  /** Width cap for the open field. */
  formClassName?: string;
}

export function InlineTextEditor({
  value,
  display,
  editLabel,
  editTooltip,
  inputLabel,
  placeholder,
  hint,
  maxLength,
  save,
  describe,
  className,
  formClassName,
}: InlineTextEditorProps) {
  const t = useTranslations("ui.inlineEdit");
  const hydrated = useHydrated();
  const [stored, setStored] = useState<string | null>(value);
  const [draft, setDraft] = useState(value ?? "");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Only a *change* in the prop counts: our own save lands in `stored` first
  // and the prop catches up to it.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setStored(value);
  }

  // Opening puts the caret in the field; closing returns focus to the opener.
  useEffect(() => {
    if (open) inputRef.current?.focus();
    else if (wasOpen.current) openerRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  function start() {
    setDraft(stored ?? "");
    setError(null);
    setWarning(null);
    setSaved(false);
    setOpen(true);
  }

  function cancel() {
    setError(null);
    setOpen(false);
  }

  async function submit() {
    setPending(true);
    setError(null);
    setWarning(null);
    setSaved(false);
    try {
      const result = await save(draft);
      if (result.ok) {
        setStored(result.value);
        setWarning(result.warning ?? null);
        setSaved(true);
        setOpen(false);
        return;
      }
      setError(result.error);
    } catch {
      setError("failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="flex flex-col gap-1">
      {!open ? (
        <span className={cn("flex items-center gap-1", className)}>
          {display(stored)}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  ref={openerRef}
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-6 shrink-0"
                  disabled={!hydrated}
                  aria-label={editLabel}
                  onClick={start}
                >
                  <Pencil aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{editTooltip}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </span>
      ) : (
        <form
          className={cn("flex max-w-[40ch] flex-col gap-1.5", formClassName)}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Input
            ref={inputRef}
            type="text"
            className="h-7 text-table"
            value={draft}
            maxLength={maxLength}
            disabled={pending}
            placeholder={placeholder}
            aria-label={inputLabel}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                cancel();
              }
            }}
          />
          {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
          <span className="flex flex-wrap gap-2">
            <Button type="submit" variant="quiet" size="sm" disabled={pending}>
              {t("save")}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={cancel}>
              {t("cancel")}
            </Button>
          </span>
        </form>
      )}
      {/* One live region for every outcome. */}
      <span
        className={cn(
          "text-xs leading-snug text-muted-foreground empty:hidden",
          error ? "text-bad" : warning ? "text-warn" : null
        )}
        role="status"
      >
        {pending ? t("saving") : null}
        {!pending && saved && !warning ? t("saved") : null}
        {!pending && warning ? describe({ warning }) : null}
        {!pending && error ? describe({ error }) : null}
      </span>
    </span>
  );
}
