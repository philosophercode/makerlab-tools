"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { DEMO_SIGNUP_ROLES } from "../../lib/db/schema/vocabulary";
import { DEMO_SIGNUP_LIMITS, parseDemoSignup, type DemoSignupField, type DemoSignupFieldError } from "../../lib/demo-pass/signup";
import { Field, errorId, hintId } from "../system/Field";
import { Prose } from "../system/PublicPage";
import { DemoSignupThanks } from "./DemoSignupThanks";
import { submitDemoSignup, type DemoSignupOutcome, type DemoSignupPayload } from "./submit-demo-signup";

/**
 * The demo sign-up form on `/demo` (demo pass spec 2026-10-07 §5.1, §6):
 * name, email and institution, three optional questions, and an unticked
 * consent box. It reads as a way to bring MakerLAB AI to your makerspace or
 * learn more, not as a pass or a credit (amendment "Sign up to learn more",
 * 2026-10-10); the pass still comes with it. Checked here with the route's own rules (`parseDemoSignup`) so
 * a mistake is said before a round trip, and again by the route, which is the
 * control. Each refused field says why beside itself and is announced; a
 * summary at the bottom says what to do next.
 *
 * The honeypot (`website`) sits off screen, out of the tab order and hidden
 * from assistive technology: a person never fills it, a form-filling bot does.
 */

type FieldErrors = Partial<Record<DemoSignupField, DemoSignupFieldError>>;
type Problem = "summary" | "rateLimited" | "unavailable" | "failed" | null;

const EMPTY: DemoSignupPayload = {
  name: "",
  email: "",
  institution: "",
  role: "",
  runsMakerspace: "",
  useCase: "",
  consent: false,
  website: "",
};

export interface DemoSignupFormProps {
  /** How many days a pass lasts, for the facts line. */
  days: number;
}

export function DemoSignupForm({ days }: DemoSignupFormProps) {
  const t = useTranslations("demoPass");
  const [values, setValues] = useState<DemoSignupPayload>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [problem, setProblem] = useState<Problem>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<Extract<DemoSignupOutcome, { kind: "done" }> | null>(null);
  const [closed, setClosed] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const set = <K extends keyof DemoSignupPayload>(key: K, value: DemoSignupPayload[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    if (key in errors) setErrors((current) => ({ ...current, [key]: undefined }));
  };

  /** Focus the first refused control, so a keyboard or screen-reader user lands on it. */
  function focusFirst(fields: FieldErrors) {
    const first = (["name", "email", "institution", "role", "useCase"] as const).find((field) => fields[field]);
    if (first) formRef.current?.querySelector<HTMLElement>(`#demo-${first}`)?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setProblem(null);
    const checked = parseDemoSignup(values);
    if (checked.kind === "invalid") {
      setErrors(checked.fields);
      setProblem("summary");
      focusFirst(checked.fields);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const outcome = await submitDemoSignup(values);
      if (outcome.kind === "done") setDone(outcome);
      else if (outcome.kind === "invalid") {
        setErrors(outcome.fields);
        setProblem("summary");
        focusFirst(outcome.fields);
      } else if (outcome.kind === "closed") setClosed(true);
      else setProblem(outcome.kind);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) return <DemoSignupThanks status={done.status} pass={done.pass} />;

  if (closed) {
    return (
      <Prose className="pt-4">
        <p role="status">{t("closedBody")}</p>
      </Prose>
    );
  }

  const describedBy = (field: DemoSignupField, hasHint = false) =>
    [hasHint ? hintId(`demo-${field}`) : null, errors[field] ? errorId(`demo-${field}`) : null].filter(Boolean).join(" ") || undefined;
  const errorText = (field: DemoSignupField) => (errors[field] ? t(`errors.${errors[field]}`) : undefined);
  const required = <span className="normal-case tracking-normal">{t("required")}</span>;
  const optional = <span className="normal-case tracking-normal">{t("optional")}</span>;

  return (
    <form ref={formRef} noValidate className="flex w-full max-w-[560px] min-w-0 flex-col gap-5 pt-6" onSubmit={handleSubmit} aria-describedby="demo-facts">
      <p id="demo-facts" className="m-0 text-sm text-muted-foreground">
        {t("passFacts", { days })}
      </p>

      <Field id="demo-name" label={t("nameLabel")} marks={required} error={errorText("name")}>
        <Input
          id="demo-name"
          name="name"
          autoComplete="name"
          value={values.name}
          onChange={(event) => set("name", event.target.value)}
          maxLength={DEMO_SIGNUP_LIMITS.name}
          required
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={describedBy("name")}
        />
      </Field>

      <Field id="demo-email" label={t("emailLabel")} marks={required} hint={t("emailHint")} error={errorText("email")}>
        <Input
          id="demo-email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={values.email}
          onChange={(event) => set("email", event.target.value)}
          maxLength={DEMO_SIGNUP_LIMITS.email}
          required
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={describedBy("email", true)}
        />
      </Field>

      <Field id="demo-institution" label={t("institutionLabel")} marks={required} hint={t("institutionHint")} error={errorText("institution")}>
        <Input
          id="demo-institution"
          name="institution"
          autoComplete="organization"
          value={values.institution}
          onChange={(event) => set("institution", event.target.value)}
          maxLength={DEMO_SIGNUP_LIMITS.institution}
          required
          aria-invalid={errors.institution ? true : undefined}
          aria-describedby={describedBy("institution", true)}
        />
      </Field>

      <Field id="demo-role" label={t("roleLabel")} marks={optional} error={errorText("role")}>
        <NativeSelect
          id="demo-role"
          name="role"
          className="w-full sm:w-72"
          value={values.role}
          onChange={(event) => set("role", event.target.value)}
          aria-invalid={errors.role ? true : undefined}
          aria-describedby={describedBy("role")}
        >
          <option value="">{t("roleChoose")}</option>
          {DEMO_SIGNUP_ROLES.map((role) => (
            <option key={role} value={role}>
              {t(`role.${role}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
        <legend className="mb-1 flex flex-wrap items-center gap-2 font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase">
          {t("makerspaceLabel")} {optional}
        </legend>
        <div className="flex flex-wrap gap-5">
          {(["yes", "no"] as const).map((answer) => (
            <label key={answer} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="runsMakerspace"
                value={answer}
                checked={values.runsMakerspace === answer}
                onChange={() => set("runsMakerspace", answer)}
                className="size-4 accent-[var(--primary)]"
              />
              {t(answer)}
            </label>
          ))}
        </div>
      </fieldset>

      <Field id="demo-useCase" label={t("useCaseLabel")} marks={optional} hint={t("useCaseHint")} error={errorText("useCase")}>
        <Textarea
          id="demo-useCase"
          name="useCase"
          rows={3}
          value={values.useCase}
          onChange={(event) => set("useCase", event.target.value)}
          maxLength={DEMO_SIGNUP_LIMITS.useCase}
          aria-invalid={errors.useCase ? true : undefined}
          aria-describedby={describedBy("useCase", true)}
        />
      </Field>

      <div className="flex items-start gap-2.5">
        <Checkbox
          id="demo-consent"
          checked={values.consent}
          onCheckedChange={(checked) => set("consent", checked === true)}
          className="mt-0.5"
        />
        <label htmlFor="demo-consent" className="text-sm leading-snug">
          {t("consentLabel")}
        </label>
      </div>

      {/* The honeypot: off screen, unreachable by Tab, silent to screen readers. */}
      <div aria-hidden="true" className="absolute -start-[10000px] top-auto size-px overflow-hidden">
        <label htmlFor="demo-website">{t("honeypotLabel")}</label>
        <input
          id="demo-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={values.website}
          onChange={(event) => set("website", event.target.value)}
        />
      </div>

      <p className="m-0 text-xs leading-snug text-muted-foreground">{t("privacy")}</p>

      <p role="alert" data-slot="form-error" className="m-0 text-sm text-bad empty:hidden">
        {problem ? t(`errors.${problem}`) : null}
      </p>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="default" disabled={submitting}>
          {submitting ? t("submitting") : t("submit")}
        </Button>
        <Button asChild>
          <Link href="/">{t("browseTools")}</Link>
        </Button>
      </div>
    </form>
  );
}
