"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { Role } from "../../lib/db/schema/vocabulary";
import { displayTitle, USER_TITLE_MAX_LENGTH } from "../../lib/people/title";
import type {
  AdminActionError,
  AdminActionWarning,
  SetTitleAction,
} from "../../app/admin/users/action-result";
import { useHydrated } from "./use-hydrated";

/**
 * A person's title in the Title column of `/admin/users`, and the inline
 * control that changes it.
 *
 * Read, it is the title `displayTitle` derives: the custom one (in ink), else
 * the role's default (`admin.titles.<role>`, muted — it is a fallback, not a
 * choice anybody made). The pencil icon button (its accessible name is "Edit
 * the title for <name>") swaps it for a text field and
 * Save / Cancel — inline, never a modal (UI system spec §6). A blank save
 * clears the custom title, and the placeholder says which default that brings
 * back.
 *
 * **It shows what the server stored, not what was typed.** The action trims and
 * collapses whitespace, so the confirmed title comes from its answer; a refusal
 * keeps the field open with the reason under it and nothing changed. Like
 * `RoleSelect`, the action arrives as a prop and the control is disabled until
 * hydrated — and the page is super admin only, so every viewer may edit.
 */

export interface TitleEditorProps {
  userId: string;
  personName: string;
  role: Role;
  /** The stored custom title, or null for the role's default. */
  title: string | null;
  /** The `setUserTitle` server action, passed down by the page. */
  action: SetTitleAction;
}

export function TitleEditor({ userId, personName, role, title, action }: TitleEditorProps) {
  const t = useTranslations("admin");
  const hydrated = useHydrated();
  // What the server last confirmed. Seeded from the row; after a save, the
  // action's own answer — the revalidated page will say the same.
  const [stored, setStored] = useState<string | null>(title);
  const [draft, setDraft] = useState(title ?? "");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AdminActionError | null>(null);
  const [saved, setSaved] = useState(false);
  const [warning, setWarning] = useState<AdminActionWarning | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // A server re-render that brings a different stored title (another
  // director's save) replaces ours — adjusted during render, not in an effect,
  // so the stale one is never painted. Only a *change* in the prop counts:
  // our own save lands in `stored` first and the prop catches up to it.
  const [seenTitle, setSeenTitle] = useState(title);
  if (title !== seenTitle) {
    setSeenTitle(title);
    setStored(title);
  }

  // Opening puts the caret in the field; closing returns focus to the opener.
  useEffect(() => {
    if (open) inputRef.current?.focus();
    else if (wasOpen.current) openerRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  const fallback = t(`titles.${role}`);
  const shown = displayTitle({ role, title: stored }, () => fallback);

  function start() {
    setDraft(stored ?? "");
    setError(null);
    setWarning(null);
    setSaved(false);
    setOpen(true);
  }

  async function save() {
    setPending(true);
    setError(null);
    setWarning(null);
    setSaved(false);
    try {
      const result = await action({ userId, title: draft });
      if (result.ok) {
        setStored(result.title);
        setWarning(result.warning ?? null);
        setSaved(true);
        setOpen(false);
        return;
      }
      setError(result.error);
    } catch {
      // Never answered: nothing is known to have changed, so nothing is shown
      // as changed (Article 4).
      setError("failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="flex flex-col gap-1">
      {!open ? (
        <span className="flex items-center gap-1">
          <span data-testid="person-title" className={cn(stored ? "text-foreground" : "text-muted-foreground")}>
            {shown}
          </span>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  ref={openerRef}
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-6"
                  disabled={!hydrated}
                  aria-label={t("personTitle.editFor", { name: personName })}
                  onClick={start}
                >
                  <Pencil aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("personTitle.edit")}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </span>
      ) : (
        <form
          className="flex max-w-[40ch] flex-col gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Input
            ref={inputRef}
            type="text"
            className="h-7 text-table"
            value={draft}
            maxLength={USER_TITLE_MAX_LENGTH}
            disabled={pending}
            placeholder={t("personTitle.placeholder", { fallback })}
            aria-label={t("personTitle.label", { name: personName })}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false);
            }}
          />
          <span className="text-xs text-muted-foreground">
            {t("personTitle.hint", { max: USER_TITLE_MAX_LENGTH })}
          </span>
          <span className="flex flex-wrap gap-2">
            <Button type="submit" variant="quiet" size="sm" disabled={pending}>
              {t("personTitle.save")}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setOpen(false)}>
              {t("personTitle.cancel")}
            </Button>
          </span>
        </form>
      )}
      {/* One live region for every outcome, as on the role select. */}
      <span
        className={cn(
          "text-xs leading-snug text-muted-foreground empty:hidden",
          error ? "text-bad" : warning ? "text-warn" : null
        )}
        role="status"
      >
        {pending ? t("saving") : null}
        {!pending && saved && !warning ? t("saved") : null}
        {!pending && warning ? t(`warnings.${warning}`) : null}
        {!pending && error ? t(`errors.${error}`) : null}
      </span>
    </span>
  );
}
