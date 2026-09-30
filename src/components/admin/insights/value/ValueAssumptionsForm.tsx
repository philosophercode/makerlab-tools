"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ValueAssumptionsResult } from "../../../../app/admin/insights/action-result";
import type { AdminActionWarning } from "../../../../lib/admin/action-result";
import { GAP_KINDS, type GapKind } from "../../../../lib/db/schema/vocabulary";
import { TERM_KINDS, valueAssumptionsSchema, type TermKind, type ValueAssumptions } from "../../../../lib/usage/value/assumptions";
import { formatHour } from "../../../../lib/usage/value/format";
import { hintId } from "../../../system/Field";
import { Button } from "../../../ui/button";
import { Input } from "../../../ui/input";
import { NativeSelect } from "../../../ui/native-select";
import { RowStatus } from "../../RowStatus";
import { useHydrated } from "../../use-hydrated";
import { useRefreshNudge } from "../../use-refresh-nudge";

/**
 * The value report's assumptions (usage insight spec amendment "Value
 * report"), edited in place under the report. Saving sends the whole set to
 * `insights.set_value_assumptions` through the page's server action, which
 * checks `insights.configure` and validates again; the report re-renders with
 * the new numbers. Checked here first with the same schema, so a term that
 * overlaps another is named before anything is sent. Without the permission
 * the same values are shown, read-only. Never printed.
 */

type Draft = {
  minutes: string;
  cost: string;
  days: number[];
  openHour: number;
  closeHour: number;
  terms: Record<TermKind, { start: string; end: string }>;
  unansweredKinds: GapKind[];
  includeMcp: boolean;
  mcpPerQuestion: string;
};

function toDraft(a: ValueAssumptions): Draft {
  const terms = Object.fromEntries(TERM_KINDS.map((kind) => {
    const term = a.terms.find((x) => x.kind === kind);
    return [kind, { start: term?.start ?? "", end: term?.end ?? "" }];
  })) as Draft["terms"];
  return {
    minutes: String(a.minutesPerQuestion),
    cost: String(a.hourlyCost),
    days: [...a.staffedHours.days],
    openHour: a.staffedHours.openHour,
    closeHour: a.staffedHours.closeHour,
    terms,
    unansweredKinds: [...a.unansweredKinds],
    includeMcp: a.includeMcp,
    mcpPerQuestion: String(a.mcpCallsPerQuestion),
  };
}

function fromDraft(d: Draft): ValueAssumptions {
  return {
    minutesPerQuestion: Number(d.minutes),
    hourlyCost: Number(d.cost),
    staffedHours: { days: [...d.days].sort((a, b) => a - b), openHour: d.openHour, closeHour: d.closeHour },
    terms: TERM_KINDS.map((kind) => ({ kind, start: d.terms[kind].start.trim(), end: d.terms[kind].end.trim() })),
    unansweredKinds: d.unansweredKinds,
    includeMcp: d.includeMcp,
    mcpCallsPerQuestion: Number(d.mcpPerQuestion),
  };
}

const CLIENT_ERRORS = ["terms_overlap", "term_backwards", "not_a_date", "hours_backwards"] as const;

export interface ValueAssumptionsFormProps {
  assumptions: ValueAssumptions;
  defaults: ValueAssumptions;
  canEdit: boolean;
  timeZone: string;
  save: (input: ValueAssumptions) => Promise<ValueAssumptionsResult>;
}

export function ValueAssumptionsForm({ assumptions, defaults, canEdit, timeZone, save }: ValueAssumptionsFormProps) {
  const t = useTranslations("admin.insights");
  const hydrated = useHydrated();
  const router = useRouter();
  const nudge = useRefreshNudge();
  const [draft, setDraft] = useState<Draft>(() => toDraft(assumptions));
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [warning, setWarning] = useState<AdminActionWarning | null>(null);
  const disabled = !canEdit || !hydrated || pending;

  const update = (patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setSaved(false);
    setError(null);
    setClientError(null);
  };
  const toggle = <T,>(list: T[], value: T, on: boolean) => (on ? [...new Set([...list, value])] : list.filter((x) => x !== value));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit) return;
    const input = fromDraft(draft);
    const parsed = valueAssumptionsSchema.safeParse(input);
    if (!parsed.success) {
      const message = parsed.error.issues.map((issue) => issue.message).find((m) => (CLIENT_ERRORS as readonly string[]).includes(m));
      setClientError(message ?? "invalid");
      return;
    }
    startTransition(async () => {
      const result = await save(parsed.data);
      if (result.ok) {
        setSaved(true);
        setWarning(result.warning ?? null);
        router.refresh();
        nudge();
      } else {
        setError(result.error);
      }
    });
  };

  const hours = Array.from({ length: 25 }, (_, h) => h);
  return (
    <section aria-labelledby="value-assumptions-heading" data-slot="value-assumptions" className="ui flex flex-col gap-3 print:hidden">
      <div className="flex flex-col gap-1">
        <h3 id="value-assumptions-heading" className="m-0 font-heading text-lg font-medium uppercase">
          {t("value.assumptions.heading")}
        </h3>
        <p className="m-0 max-w-[78ch] text-sm text-muted-foreground">{t("value.assumptions.note")}</p>
        {!canEdit ? <p className="m-0 text-sm text-muted-foreground">{t("value.assumptions.readOnly")}</p> : null}
      </div>
      <form onSubmit={submit} aria-labelledby="value-assumptions-heading" className="flex flex-col gap-5">
        <fieldset disabled={disabled} className="m-0 grid gap-4 border-0 p-0 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField id="va-minutes" label={t("value.assumptions.minutes")} hint={t("value.assumptions.minutesHint")} value={draft.minutes} step="0.5" min="0.5" max="60" onChange={(minutes) => update({ minutes })} />
          <NumberField id="va-cost" label={t("value.assumptions.cost")} hint={t("value.assumptions.costHint")} value={draft.cost} step="1" min="0" max="1000" onChange={(cost) => update({ cost })} />
          <div className="flex flex-col gap-1">
            <label htmlFor="va-open" className="font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase">
              {t("value.assumptions.open")}
            </label>
            <NativeSelect id="va-open" value={String(draft.openHour)} onChange={(e) => update({ openHour: Number(e.target.value) })} aria-describedby={hintId("va-hours")}>
              {hours.slice(0, 24).map((h) => (
                <option key={h} value={h}>
                  {formatHour(h)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="va-close" className="font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase">
              {t("value.assumptions.close")}
            </label>
            <NativeSelect id="va-close" value={String(draft.closeHour)} onChange={(e) => update({ closeHour: Number(e.target.value) })} aria-describedby={hintId("va-hours")}>
              {hours.slice(1).map((h) => (
                <option key={h} value={h}>
                  {formatHour(h)}
                </option>
              ))}
            </NativeSelect>
          </div>
        </fieldset>

        <fieldset disabled={disabled} className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase">{t("value.assumptions.days")}</legend>
          <div className="flex flex-wrap gap-3">
            {[1, 2, 3, 4, 5, 6, 0].map((day) => (
              <label key={day} className="inline-flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={draft.days.includes(day)} onChange={(e) => update({ days: toggle(draft.days, day, e.target.checked) })} />
                {t(`heatmap.days.${day}`)}
              </label>
            ))}
          </div>
          <p id={hintId("va-hours")} className="m-0 text-xs text-muted-foreground">
            {t("value.assumptions.hoursHint", { timeZone })}
          </p>
        </fieldset>

        <fieldset disabled={disabled} className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase">{t("value.assumptions.terms")}</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {TERM_KINDS.map((kind) => {
              const name = t("value.termKind", { term: kind });
              return (
                <div key={kind} className="flex gap-2">
                  <TextField id={`va-${kind}-start`} label={t("value.assumptions.termStart", { term: name })} value={draft.terms[kind].start} onChange={(start) => update({ terms: { ...draft.terms, [kind]: { ...draft.terms[kind], start } } })} />
                  <TextField id={`va-${kind}-end`} label={t("value.assumptions.termEnd", { term: name })} value={draft.terms[kind].end} onChange={(end) => update({ terms: { ...draft.terms, [kind]: { ...draft.terms[kind], end } } })} />
                </div>
              );
            })}
          </div>
          <p className="m-0 text-xs text-muted-foreground">{t("value.assumptions.termsHint")}</p>
        </fieldset>

        <fieldset disabled={disabled} className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase">{t("value.assumptions.unanswered")}</legend>
          <div className="flex flex-wrap gap-3">
            {GAP_KINDS.map((kind) => (
              <label key={kind} className="inline-flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={draft.unansweredKinds.includes(kind)} onChange={(e) => update({ unansweredKinds: toggle(draft.unansweredKinds, kind, e.target.checked) })} />
                {t(`gaps.kind.${kind}`)}
              </label>
            ))}
          </div>
          <p className="m-0 text-xs text-muted-foreground">{t("value.assumptions.unansweredHint")}</p>
        </fieldset>

        <fieldset disabled={disabled} className="m-0 flex flex-wrap items-end gap-4 border-0 p-0">
          <label className="inline-flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={draft.includeMcp} onChange={(e) => update({ includeMcp: e.target.checked })} />
            {t("value.assumptions.mcp")}
          </label>
          <NumberField id="va-mcp" label={t("value.assumptions.mcpPerQuestion")} hint={t("value.assumptions.mcpHint")} value={draft.mcpPerQuestion} step="1" min="1" max="10" onChange={(mcpPerQuestion) => update({ mcpPerQuestion })} />
        </fieldset>

        {canEdit ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="default" disabled={disabled}>
              {t("value.assumptions.save")}
            </Button>
            <Button type="button" disabled={disabled} onClick={() => update(toDraft(defaults))}>
              {t("value.assumptions.defaults")}
            </Button>
            <RowStatus pending={pending} saved={saved} error={error} warning={warning} className="basis-auto" />
          </div>
        ) : null}
        {clientError ? (
          <RowStatus tone="bad" role="alert">
            {t(`value.assumptions.errors.${clientError}`)}
          </RowStatus>
        ) : null}
      </form>
    </section>
  );
}

function NumberField({ id, label, hint, value, step, min, max, onChange }: { id: string; label: string; hint: string; value: string; step: string; min: string; max: string; onChange: (value: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase">
        {label}
      </label>
      <Input id={id} type="number" inputMode="decimal" step={step} min={min} max={max} value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={hintId(id)} className="w-32" />
      <p id={hintId(id)} className="m-0 text-xs text-muted-foreground">
        {hint}
      </p>
    </div>
  );
}

function TextField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase">
        {label}
      </label>
      <Input id={id} value={value} inputMode="numeric" placeholder="MM-DD" pattern="\d{2}-\d{2}" maxLength={5} onChange={(e) => onChange(e.target.value)} className="w-24" />
    </div>
  );
}
