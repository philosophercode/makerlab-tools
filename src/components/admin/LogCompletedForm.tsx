"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { LogCompletedAction, MaintenanceActionError } from "../../app/admin/maintenance/action-result";
import { COMPLETED_MAINTENANCE_TYPES, type CompletedMaintenanceType } from "../../lib/db/schema/vocabulary";
import { Field } from "../system/Field";
import { ReviewNote } from "../system/review/ReviewCard";
import { useHydrated } from "./use-hydrated";

/**
 * **Log completed maintenance** on `/admin/maintenance` (assistant–GUI
 * parity spec §11 answer 5): record work already done — a new belt, a
 * calibration — as a ticket that starts resolved, with the signed-in person
 * as the one who did it. The assistant's `log_completed_maintenance` card
 * commits the same `tickets.log_completed` definition.
 *
 * A button that opens the form inline, like **Add person**: never a modal;
 * **Log it** (the one filled button) and **Cancel**; Escape cancels and focus
 * goes back to the button. The action checks everything itself; a refusal
 * keeps what was typed and says why, a landed log closes the form and says
 * so, and the page re-renders with the row in the resolved list.
 */

export interface LogCompletedTool {
  id: string;
  name: string;
  units: { id: string; label: string }[];
}

export interface LogCompletedFormProps {
  tools: LogCompletedTool[];
  action: LogCompletedAction;
}

type Outcome = { kind: "saved"; unaudited: boolean } | { kind: "error"; error: MaintenanceActionError | "needTool" | "needText" };

export function LogCompletedForm({ tools, action }: LogCompletedFormProps) {
  const t = useTranslations("admin.maintenance.logCompleted");
  const tm = useTranslations("admin.maintenance");
  const te = useTranslations("admin.errors");
  const tw = useTranslations("admin.warnings");
  const hydrated = useHydrated();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [toolId, setToolId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [title, setTitle] = useState("");
  const [resolution, setResolution] = useState("");
  const [type, setType] = useState<CompletedMaintenanceType>("repair");
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const toolRef = useRef<HTMLSelectElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) toolRef.current?.focus();
    else if (wasOpen.current) openerRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  const units = tools.find((tool) => tool.id === toolId)?.units ?? [];
  const field = (key: string) => `${id}-${key}`;

  function reset() {
    setToolId("");
    setUnitId("");
    setTitle("");
    setResolution("");
    setType("repair");
  }

  function cancel() {
    if (pending) return;
    reset();
    setOutcome(null);
    setOpen(false);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!toolId) return setOutcome({ kind: "error", error: "needTool" });
    if (!title.trim() || !resolution.trim()) return setOutcome({ kind: "error", error: "needText" });
    setPending(true);
    setOutcome(null);
    try {
      const result = await action({ tool: toolId, unitId: unitId || null, title, resolution, type });
      if (result.ok) {
        reset();
        setOpen(false);
        setOutcome({ kind: "saved", unaudited: Boolean(result.warning) });
        return;
      }
      setOutcome({ kind: "error", error: result.error });
    } catch {
      setOutcome({ kind: "error", error: "failed" });
    } finally {
      setPending(false);
    }
  }

  const errorText = (error: Extract<Outcome, { kind: "error" }>["error"]) =>
    error === "needTool" ? t("needTool") : error === "needText" ? t("needText") : te(error);

  return (
    <section className="ui flex flex-col gap-2" aria-label={t("heading")}>
      {!open ? (
        <Button
          ref={openerRef}
          type="button"
          size="sm"
          className="self-start"
          disabled={!hydrated}
          onClick={() => {
            setOutcome(null);
            setOpen(true);
          }}
        >
          {t("open")}
        </Button>
      ) : (
        <form
          className="flex flex-col gap-3 border border-rule p-3"
          onSubmit={(event) => void submit(event)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !event.defaultPrevented) {
              event.preventDefault();
              cancel();
            }
          }}
        >
          <p className="m-0 max-w-[72ch] text-sm text-muted-foreground">{t("lede")}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field id={field("tool")} label={t("tool")}>
              <NativeSelect
                ref={toolRef}
                id={field("tool")}
                value={toolId}
                disabled={pending}
                onChange={(event) => {
                  setToolId(event.target.value);
                  setUnitId("");
                }}
              >
                <option value="">{t("toolPlaceholder")}</option>
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
                value={unitId}
                disabled={pending || units.length === 0}
                onChange={(event) => setUnitId(event.target.value)}
              >
                <option value="">{t("wholeTool")}</option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id={field("type")} label={t("type")}>
              <NativeSelect
                id={field("type")}
                value={type}
                disabled={pending}
                onChange={(event) => setType(event.target.value as CompletedMaintenanceType)}
              >
                {COMPLETED_MAINTENANCE_TYPES.map((option) => (
                  <option key={option} value={option}>
                    {tm(`type.${option}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field id={field("title")} label={t("title")}>
            <Input
              id={field("title")}
              type="text"
              maxLength={200}
              placeholder={t("titlePlaceholder")}
              value={title}
              disabled={pending}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field id={field("resolution")} label={t("resolution")}>
            <Textarea
              id={field("resolution")}
              rows={3}
              maxLength={2000}
              placeholder={t("resolutionPlaceholder")}
              value={resolution}
              disabled={pending}
              onChange={(event) => setResolution(event.target.value)}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="default" size="sm" disabled={pending}>
              {t("save")}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={cancel}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      )}
      {outcome?.kind === "saved" ? (
        <ReviewNote role="status" tone={outcome.unaudited ? "warn" : "ink"}>
          {outcome.unaudited ? tw("audit_unavailable") : t("saved")}
        </ReviewNote>
      ) : null}
      {outcome?.kind === "error" ? (
        <ReviewNote role="alert" tone="bad">
          {errorText(outcome.error)}
        </ReviewNote>
      ) : null}
    </section>
  );
}
