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
 * The action arrives as a prop and does every check itself (signed in,
 * `users.manage`, the domain rule, the blocked list, a duplicate address);
 * a refusal keeps what was typed and says why, a success clears the form and
 * names the address. The page re-renders with the new row.
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
  const formId = `${id}-form`;

  useEffect(() => {
    if (open) emailRef.current?.focus();
  }, [open]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setOutcome(null);
    try {
      const result = await action({ email, name, role, title: title || null });
      if (result.ok) {
        setOutcome({ kind: "added", email: result.person.email, unaudited: Boolean(result.warning) });
        setEmail("");
        setName("");
        setRole("user");
        setTitle("");
        emailRef.current?.focus();
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
      <Button
        type="button"
        variant={open ? "quiet" : "default"}
        size="sm"
        className="self-start"
        disabled={!hydrated}
        aria-expanded={open}
        aria-controls={formId}
        onClick={() => setOpen((current) => !current)}
      >
        {t("addPerson.heading")}
      </Button>
      {open ? (
        <form
          id={formId}
          className="flex flex-col gap-3 border border-rule p-3"
          onSubmit={(event) => void submit(event)}
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
          </div>
        </form>
      ) : null}
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
