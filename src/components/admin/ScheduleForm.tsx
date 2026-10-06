"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ScheduleActionError, ScheduleFields } from "../../app/admin/maintenance/schedule-result";
import { SCHEDULE_INTERVAL_UNIT, type ScheduleIntervalUnit } from "../../lib/db/schema/vocabulary";
import { INTERVAL_COUNT_MAX, isIsoDate } from "../../lib/maintenance/interval";
import { Field, hintId } from "../system/Field";
import { ReviewNote } from "../system/review/ReviewCard";

/**
 * The form a recurring task is set up or edited in (recurring maintenance
 * spec §6, amendment 2026-10-06). Inline, never a modal, like **Log completed
 * maintenance**: one column on a phone, **Add task** / **Save** as the one
 * filled button, Escape cancels.
 *
 * Fields, in the order a SuperMaker thinks of them: what the task is, where
 * (a tool, one unit, each unit, or no tool for general lab upkeep), how often,
 * when it is first due, and how to do it. "Each unit" is the default for a
 * tool with more than one unit (spec §13 Q4) and exists only when creating.
 * The first due date defaults to today, so a new task shows in the due list
 * at once. The action checks everything again; the form checks only what it
 * can say better beside the field.
 */

export interface ScheduleToolOption {
  id: string;
  name: string;
  units: { id: string; label: string }[];
}

export type ScheduleFormResult = { ok: true; created?: number; unaudited: boolean } | { ok: false; error: ScheduleActionError };

export interface ScheduleFormProps {
  tools: ScheduleToolOption[];
  /** The lab's today, `YYYY-MM-DD`. */
  today: string;
  /** The task being edited; absent when creating. */
  initial?: Omit<ScheduleFields, "eachUnit">;
  submit: (fields: ScheduleFields) => Promise<ScheduleFormResult>;
  onCancel: () => void;
  onSaved: (result: { created?: number; unaudited: boolean }) => void;
}

type FormError = ScheduleActionError | "needTitle" | "needInterval" | "needDate";

export function ScheduleForm({ tools, today, initial, submit, onCancel, onSaved }: ScheduleFormProps) {
  const t = useTranslations("admin.schedules.form");
  const te = useTranslations("admin.errors");
  const id = useId();
  const editing = Boolean(initial);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [toolId, setToolId] = useState(initial?.toolId ?? "");
  // "" the tool as a whole, "each" one task per unit, or a unit's id.
  const [unitChoice, setUnitChoice] = useState(initial?.unitId ?? "");
  const [intervalCount, setIntervalCount] = useState(String(initial?.intervalCount ?? 1));
  const [intervalUnit, setIntervalUnit] = useState<ScheduleIntervalUnit>((initial?.intervalUnit as ScheduleIntervalUnit) ?? "week");
  const [dueOn, setDueOn] = useState(initial?.dueOn ?? today);
  const [instructions, setInstructions] = useState(initial?.instructions ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const units = tools.find((tool) => tool.id === toolId)?.units ?? [];
  const field = (key: string) => `${id}-${key}`;
  const count = Number(intervalCount);

  function chooseTool(next: string) {
    setToolId(next);
    const nextUnits = tools.find((tool) => tool.id === next)?.units ?? [];
    // Spec §13 Q4: a physical task on a tool with several units is per unit.
    setUnitChoice(!editing && nextUnits.length > 1 ? "each" : "");
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return setError("needTitle");
    if (!Number.isInteger(count) || count < 1 || count > INTERVAL_COUNT_MAX) return setError("needInterval");
    if (!isIsoDate(dueOn)) return setError("needDate");
    setPending(true);
    setError(null);
    try {
      const result = await submit({
        title,
        instructions,
        toolId: toolId || null,
        unitId: unitChoice && unitChoice !== "each" ? unitChoice : null,
        eachUnit: unitChoice === "each",
        intervalCount: count,
        intervalUnit,
        dueOn,
      });
      if (result.ok) {
        onSaved({ created: result.created, unaudited: result.unaudited });
        return;
      }
      setError(result.error);
    } catch {
      setError("failed");
    } finally {
      setPending(false);
    }
  }

  const errorText = (code: FormError) =>
    code === "needTitle" || code === "needInterval" || code === "needDate" ? t(code) : te(code);

  return (
    <form
      aria-label={editing ? t("editHeading") : t("heading")}
      // The form's own checks say what is wrong beside it, in the page's words.
      noValidate
      className="ui flex flex-col gap-3 border border-rule p-3"
      onSubmit={(event) => void onSubmit(event)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented && !pending) {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <p className="m-0 max-w-[72ch] text-sm text-muted-foreground">{editing ? t("editLede") : t("lede")}</p>
      <Field id={field("title")} label={t("title")}>
        <Input
          ref={titleRef}
          id={field("title")}
          type="text"
          maxLength={120}
          placeholder={t("titlePlaceholder")}
          value={title}
          disabled={pending}
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id={field("tool")} label={t("tool")}>
          <NativeSelect id={field("tool")} value={toolId} disabled={pending} onChange={(event) => chooseTool(event.target.value)}>
            <option value="">{t("general")}</option>
            {tools.map((tool) => (
              <option key={tool.id} value={tool.id}>
                {tool.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id={field("unit")} label={t("unit")}>
          <NativeSelect
            id={field("unit")}
            value={unitChoice}
            disabled={pending || !toolId || units.length === 0}
            onChange={(event) => setUnitChoice(event.target.value)}
          >
            <option value="">{t("wholeTool")}</option>
            {!editing && units.length > 1 ? <option value="each">{t("eachUnit", { count: units.length })}</option> : null}
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field id={field("count")} label={t("every")}>
          <Input
            id={field("count")}
            type="number"
            inputMode="numeric"
            min={1}
            max={INTERVAL_COUNT_MAX}
            step={1}
            value={intervalCount}
            disabled={pending}
            onChange={(event) => setIntervalCount(event.target.value)}
          />
        </Field>
        <Field id={field("unitOfTime")} label={t("intervalUnit")}>
          <NativeSelect
            id={field("unitOfTime")}
            value={intervalUnit}
            disabled={pending}
            onChange={(event) => setIntervalUnit(event.target.value as ScheduleIntervalUnit)}
          >
            {SCHEDULE_INTERVAL_UNIT.map((unit) => (
              <option key={unit} value={unit}>
                {t(`units.${unit}`, { count: Number.isInteger(count) && count > 0 ? count : 2 })}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          id={field("due")}
          label={editing ? t("nextDue") : t("firstDue")}
          hint={isIsoDate(dueOn) && dueOn < today ? t("pastDue") : undefined}
        >
          <Input
            id={field("due")}
            type="date"
            value={dueOn}
            disabled={pending}
            aria-describedby={hintId(field("due"))}
            onChange={(event) => setDueOn(event.target.value)}
          />
        </Field>
      </div>
      <Field id={field("instructions")} label={t("instructions")}>
        <Textarea
          id={field("instructions")}
          rows={3}
          maxLength={2000}
          placeholder={t("instructionsPlaceholder")}
          value={instructions}
          disabled={pending}
          onChange={(event) => setInstructions(event.target.value)}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="default" size="sm" disabled={pending}>
          {editing ? t("saveEdit") : t("save")}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onCancel}>
          {t("cancel")}
        </Button>
      </div>
      {error ? (
        <ReviewNote role="alert" tone="bad">
          {errorText(error)}
        </ReviewNote>
      ) : null}
    </form>
  );
}
