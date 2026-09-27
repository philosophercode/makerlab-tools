"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { ROLES, type Role } from "../../lib/db/schema/vocabulary";
import { USER_TITLE_MAX_LENGTH } from "../../lib/people/title";
import {
  PERSON_NAME_MAX_LENGTH,
  type AddPersonAction,
  type AdminActionError,
} from "../../app/admin/users/action-result";
import { Field, hintId } from "../system/Field";
import { useHydrated } from "./use-hydrated";

/**
 * **Add person** on `/admin/users`: put somebody on the roster before they
 * have signed in, with the role and title they should arrive with. The row
 * shows "Not signed in yet" until their first Google sign-in, which attaches
 * to it (`account.accountLinking` in `lib/auth/config.ts`) instead of creating
 * a second account.
 *
 * A button that opens the form inline — never a modal (UI system spec §6).
 * While the form is open the button is gone, so there is one "Add person"
 * on screen, not two: the form's own buttons are **Add** (the primary) and
 * **Cancel**. Cancel — or Escape anywhere in the form — closes it, empties it
 * and puts focus back on the Add person button.
 *
 * The action arrives as a prop and does every check itself (signed in,
 * `users.manage`, the domain rule, the blocked list, a duplicate address);
 * a refusal keeps what was typed and says why, a success empties the form for
 * the next person and names the address. The page re-renders with the new row.
 *
 * A name typed here is kept at their first sign-in; left blank, the address
 * stands in until Google's name replaces it (`lib/auth/provider-name.ts`).
 */

export interface AddPersonFormProps {
  /** The `addPerson` server action, passed down by the page. */
  action: AddPersonAction;
}

type Outcome =
  | { kind: "added"; email: string; unaudited: boolean }
  | { kind: "error"; error: AdminActionError };

export function AddPersonForm({ action }: AddPersonFormProps) {
  const t = useTranslations("admin");
  const hydrated = useHydrated();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const formId = `${id}-form`;

  // Opening puts the caret in Email; closing (Cancel, Escape) hands focus back
  // to the Add person button, which is only rendered while the form is shut.
  useEffect(() => {
    if (open) emailRef.current?.focus();
    else if (wasOpen.current) openerRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  // A disabled field cannot take focus, so after a landed add it waits for
  // `pending` to clear.
  const refocusEmail = useRef(false);
  useEffect(() => {
    if (!pending && refocusEmail.current) {
      refocusEmail.current = false;
      emailRef.current?.focus();
    }
  }, [pending]);

  function reset() {
    setEmail("");
    setName("");
    setRole("user");
    setTitle("");
  }

  /** Close and forget: what was typed, and whatever the last attempt said. */
  function cancel() {
    if (pending) return;
    reset();
    // A refusal is about what was typed, which is gone; "added" stays said.
    setOutcome((current) => (current?.kind === "error" ? null : current));
    setOpen(false);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setOutcome(null);
    try {
      const result = await action({ email, name, role, title: title || null });
      if (result.ok) {
        setOutcome({ kind: "added", email: result.person.email, unaudited: Boolean(result.warning) });
        // Stays open, emptied, for the next person; Cancel closes it. The
        // caret goes back to Email once the fields are enabled again.
        reset();
        refocusEmail.current = true;
        return;
      }
      setOutcome({ kind: "error", error: result.error });
    } catch {
      setOutcome({ kind: "error", error: "failed" });
    } finally {
      setPending(false);
    }
  }

  const field = (key: string) => `${id}-${key}`;

  return (
    <section className="ui flex flex-col gap-2" aria-label={t("addPerson.heading")}>
      {!open ? (
        <Button
          ref={openerRef}
          type="button"
          variant="default"
          size="sm"
          className="self-start"
          disabled={!hydrated}
          onClick={() => {
            setOutcome(null);
            setOpen(true);
          }}
        >
          {t("addPerson.heading")}
        </Button>
      ) : (
        <form
          id={formId}
          className="flex flex-col gap-3 border border-rule p-3"
          onSubmit={(event) => void submit(event)}
          onKeyDown={(event) => {
            // Escape anywhere in the form cancels it — but not while a native
            // select's own list is what Escape is closing.
            if (event.key === "Escape" && !event.defaultPrevented) {
              event.preventDefault();
              cancel();
            }
          }}
        >
          <p className="m-0 max-w-[72ch] text-sm text-muted-foreground">{t("addPerson.lede")}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(14rem,1.4fr)_minmax(10rem,1fr)_auto_minmax(10rem,1fr)]">
            <Field id={field("email")} label={t("addPerson.email")}>
              <Input
                ref={emailRef}
                id={field("email")}
                type="email"
                required
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                value={email}
                disabled={pending}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <Field id={field("name")} label={t("addPerson.name")} hint={t("addPerson.nameHint")}>
              <Input
                id={field("name")}
                type="text"
                autoComplete="off"
                maxLength={PERSON_NAME_MAX_LENGTH}
                value={name}
                disabled={pending}
                aria-describedby={hintId(field("name"))}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field id={field("role")} label={t("addPerson.role")}>
              <NativeSelect
                id={field("role")}
                value={role}
                disabled={pending}
                onChange={(event) => setRole(event.target.value as Role)}
              >
                {ROLES.map((option) => (
                  <option key={option} value={option}>
                    {t(`roles.${option}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id={field("title")} label={t("addPerson.title")} hint={t("addPerson.titleHint")}>
              <Input
                id={field("title")}
                type="text"
                autoComplete="off"
                maxLength={USER_TITLE_MAX_LENGTH}
                value={title}
                placeholder={t(`titles.${role}`)}
                disabled={pending}
                aria-describedby={hintId(field("title"))}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="default" size="sm" disabled={pending || !email.trim()}>
              {pending ? t("addPerson.adding") : t("addPerson.submit")}
            </Button>
            <Button type="button" variant="quiet" size="sm" disabled={pending} onClick={cancel}>
              {t("addPerson.cancel")}
            </Button>
          </div>
        </form>
      )}
      <p
        role="status"
        className={cn(
          "m-0 text-xs leading-snug text-muted-foreground empty:hidden",
          outcome?.kind === "error" ? "text-bad" : outcome?.kind === "added" && outcome.unaudited ? "text-warn" : null
        )}
      >
        {outcome?.kind === "added"
          ? t(outcome.unaudited ? "addPerson.addedUnaudited" : "addPerson.added", { email: outcome.email })
          : null}
        {outcome?.kind === "error" ? t(`errors.${outcome.error}`) : null}
      </p>
    </section>
  );
}
