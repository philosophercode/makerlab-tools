"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type {
  CompleteScheduleAction,
  CreateScheduleAction,
  ScheduleActionError,
  SetScheduleStatusAction,
  UpdateScheduleAction,
} from "../../app/admin/maintenance/schedule-result";
import type { ScheduleView } from "../../lib/data/maintenance-schedules";
import type { ScheduleStatus } from "../../lib/db/schema/vocabulary";
import { EmptyState } from "../system/EmptyState";
import { StatusGlyph, type StatusTone } from "../system/StatusGlyph";
import { ReviewCard, ReviewNote } from "../system/review/ReviewCard";
import { ScheduleForm, type ScheduleToolOption } from "./ScheduleForm";
import { DUE_TONE, dueLabel, everyLabel, whereLabel } from "./schedule-labels";
import { TaskDoneControl } from "./TaskDoneControl";
import { useHydrated } from "./use-hydrated";
import { useRefreshNudge } from "./use-refresh-nudge";

/**
 * Every recurring task on `/admin/maintenance/schedules` (recurring
 * maintenance spec §6, amendment 2026-10-06): **New recurring task** at the
 * top, the active tasks oldest-due first, and paused and archived ones behind
 * a disclosure so the list a person works stays short.
 *
 * Each card says what, where, how often, when it is next due and when it was
 * last done, with **Done**, **Edit**, **Pause** and **Archive** on it, and the
 * latest check-offs (who, when, their note) under a disclosure. Edit swaps the
 * card for the same form New uses. Every action is a prop, so a component test
 * mounts it.
 */

export interface ScheduleBoardProps {
  schedules: ScheduleView[];
  tools: ScheduleToolOption[];
  today: string;
  create: CreateScheduleAction;
  edit: UpdateScheduleAction;
  setStatus: SetScheduleStatusAction;
  complete: CompleteScheduleAction;
}

type Notice = { kind: "created"; count: number } | { kind: "saved" } | { kind: "done"; title: string; nextDueOn: string } | { kind: "unaudited" };

const STATUS_TONE: Record<ScheduleStatus, StatusTone> = { active: "ok", paused: "idle", archived: "muted" };

export function ScheduleBoard({ schedules, tools, today, create, edit, setStatus, complete }: ScheduleBoardProps) {
  const t = useTranslations("admin.schedules");
  const tw = useTranslations("admin.warnings");
  const hydrated = useHydrated();
  const nudge = useRefreshNudge();
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const wasCreating = useRef(false);

  useEffect(() => {
    if (!creating && wasCreating.current) openerRef.current?.focus();
    wasCreating.current = creating;
  }, [creating]);

  const active = schedules.filter((schedule) => schedule.status === "active");
  const resting = schedules.filter((schedule) => schedule.status !== "active");

  const landed = (next: Notice, unaudited: boolean) => {
    setNotice(unaudited ? { kind: "unaudited" } : next);
    nudge();
  };

  const noticeText = (n: Notice) =>
    n.kind === "created"
      ? t("form.saved", { count: n.count })
      : n.kind === "saved"
        ? t("form.savedEdit")
        : n.kind === "done"
          ? t("doneSaved", { title: n.title, date: n.nextDueOn })
          : tw("audit_unavailable");

  return (
    <div className="ui flex flex-col gap-4">
      <section aria-label={t("form.heading")} className="flex flex-col gap-2">
        {!creating ? (
          <Button
            ref={openerRef}
            type="button"
            size="sm"
            variant="default"
            className="self-start"
            disabled={!hydrated}
            onClick={() => {
              setNotice(null);
              setCreating(true);
            }}
          >
            {t("new")}
          </Button>
        ) : (
          <ScheduleForm
            tools={tools}
            today={today}
            submit={async (fields) => {
              const result = await create(fields);
              return result.ok ? { ok: true, created: result.created, unaudited: Boolean(result.warning) } : result;
            }}
            onCancel={() => setCreating(false)}
            onSaved={({ created, unaudited }) => {
              setCreating(false);
              landed({ kind: "created", count: created ?? 1 }, unaudited);
            }}
          />
        )}
        {notice ? (
          <ReviewNote role="status" tone={notice.kind === "unaudited" ? "warn" : "ink"}>
            {noticeText(notice)}
          </ReviewNote>
        ) : null}
      </section>

      <section aria-labelledby="schedules-active-heading" className="flex flex-col gap-1">
        <h3 id="schedules-active-heading" className="m-0 font-mono text-label font-medium tracking-[0.08em] uppercase">
          {t("activeHeading", { count: active.length })}
        </h3>
        {active.length === 0 ? (
          <EmptyState>{schedules.length === 0 ? t("emptyAll") : t("emptyActive")}</EmptyState>
        ) : (
          <ul aria-label={t("activeList")} className="m-0 flex list-none flex-col p-0">
            {active.map((schedule) => (
              <li key={schedule.id}>
                <ScheduleCard
                  schedule={schedule}
                  tools={tools}
                  today={today}
                  edit={edit}
                  setStatus={setStatus}
                  complete={complete}
                  onLanded={landed}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {resting.length > 0 ? (
        <details className="group flex flex-col gap-1">
          <summary className="cursor-pointer font-mono text-label tracking-[0.08em] text-muted-foreground uppercase">
            {t("restingToggle", { count: resting.length })}
          </summary>
          <ul aria-label={t("restingList")} className="m-0 flex list-none flex-col p-0">
            {resting.map((schedule) => (
              <li key={schedule.id}>
                <ScheduleCard
                  schedule={schedule}
                  tools={tools}
                  today={today}
                  edit={edit}
                  setStatus={setStatus}
                  complete={complete}
                  onLanded={landed}
                />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function ScheduleCard({
  schedule,
  tools,
  today,
  edit,
  setStatus,
  complete,
  onLanded,
}: {
  schedule: ScheduleView;
  tools: ScheduleToolOption[];
  today: string;
  edit: UpdateScheduleAction;
  setStatus: SetScheduleStatusAction;
  complete: CompleteScheduleAction;
  onLanded: (notice: Notice, unaudited: boolean) => void;
}) {
  const t = useTranslations("admin.schedules");
  const te = useTranslations("admin.errors");
  const hydrated = useHydrated();
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ScheduleActionError | null>(null);
  const isActive = schedule.status === "active";
  const due = dueLabel(t, schedule.nextDueOn, today);
  // An archived tool is still listed so the task can be moved; it is no option for a new one.
  const toolChoices =
    schedule.toolId && !tools.some((tool) => tool.id === schedule.toolId)
      ? [...tools, { id: schedule.toolId, name: schedule.toolName ?? "", units: schedule.unitId ? [{ id: schedule.unitId, label: schedule.unitLabel ?? "" }] : [] }]
      : tools;

  async function changeStatus(status: ScheduleStatus) {
    setPending(true);
    setError(null);
    try {
      const result = await setStatus({ scheduleId: schedule.id, status });
      if (result.ok) onLanded({ kind: "saved" }, Boolean(result.warning));
      else setError(result.error);
    } catch {
      setError("failed");
    } finally {
      setPending(false);
    }
  }

  if (editing) {
    return (
      <div className="border-b border-rule py-3">
        <ScheduleForm
          tools={toolChoices}
          today={today}
          initial={{
            title: schedule.title,
            instructions: schedule.instructions ?? "",
            toolId: schedule.toolId,
            unitId: schedule.unitId,
            intervalCount: schedule.interval.count,
            intervalUnit: schedule.interval.unit,
            dueOn: schedule.nextDueOn,
          }}
          submit={async (fields) => {
            const result = await edit({ scheduleId: schedule.id, fields });
            return result.ok ? { ok: true, unaudited: Boolean(result.warning) } : result;
          }}
          onCancel={() => setEditing(false)}
          onSaved={({ unaudited }) => {
            setEditing(false);
            onLanded({ kind: "saved" }, unaudited);
          }}
        />
      </div>
    );
  }

  // Archiving is undone with Resume, so no action here wears the destructive look.
  const rowButton = (label: string, aria: string, onClick: () => void) => (
    <Button type="button" size="xs" variant="ghost" disabled={!hydrated || pending} aria-label={aria} onClick={onClick}>
      {label}
    </Button>
  );

  return (
    <ReviewCard
      label={schedule.title}
      headingLevel={4}
      tone={!isActive ? "settled" : due.state === "overdue" ? "safety" : due.state === "today" ? "warn" : "default"}
      marks={
        isActive ? (
          <StatusGlyph tone={DUE_TONE[due.state]} label={due.text} />
        ) : (
          <StatusGlyph tone={STATUS_TONE[schedule.status]} label={t(`status.${schedule.status}`)} />
        )
      }
      actions={
        <>
          {rowButton(t("edit"), t("editFor", { title: schedule.title }), () => setEditing(true))}
          {schedule.status === "active" ? rowButton(t("pause"), t("pauseFor", { title: schedule.title }), () => void changeStatus("paused")) : null}
          {schedule.status !== "active" ? rowButton(t("resume"), t("resumeFor", { title: schedule.title }), () => void changeStatus("active")) : null}
          {schedule.status !== "archived"
            ? rowButton(t("archive"), t("archiveFor", { title: schedule.title }), () => void changeStatus("archived"))
            : null}
        </>
      }
      meta={
        <>
          {schedule.toolSlug ? (
            <Link className="text-primary-ink hover:underline" href={`/tools/${schedule.toolSlug}`}>
              {whereLabel(t, schedule)}
            </Link>
          ) : (
            <span>{whereLabel(t, schedule)}</span>
          )}
          {schedule.toolArchived ? <span>{t("toolArchived")}</span> : null}
          <span>{everyLabel(t, schedule.interval)}</span>
          <span className="tabular-nums">{t("dueOn", { date: schedule.nextDueOn })}</span>
          <span className="tabular-nums">{schedule.lastDoneOn ? t("lastDone", { date: schedule.lastDoneOn }) : t("neverDone")}</span>
        </>
      }
    >
      {schedule.instructions ? <p className="m-0 max-w-[78ch] text-sm leading-relaxed whitespace-pre-wrap">{schedule.instructions}</p> : null}

      {schedule.recent.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">{t("recentToggle", { count: schedule.recent.length })}</summary>
          <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0 text-xs">
            {schedule.recent.map((entry) => (
              <li key={entry.id} className="flex flex-wrap gap-x-2">
                <span className="font-mono tabular-nums">{entry.doneOn}</span>
                <span className="text-muted-foreground">{entry.doneByName ? t("doneBy", { name: entry.doneByName }) : t("doneByUnknown")}</span>
                {entry.doneOn > entry.dueOn ? (
                  <span className="text-muted-foreground">{t("doneLate", { date: entry.dueOn })}</span>
                ) : null}
                {/* Somebody typed this; their line breaks are part of what they said. */}
                {entry.note ? <span className="basis-full whitespace-pre-wrap">{entry.note}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {isActive ? (
        <TaskDoneControl
          scheduleId={schedule.id}
          title={schedule.title}
          dueOn={schedule.nextDueOn}
          action={complete}
          onDone={(result) => onLanded({ kind: "done", title: result.title, nextDueOn: result.nextDueOn }, result.unaudited)}
        />
      ) : null}

      {error ? (
        <ReviewNote role="alert" tone="bad">
          {te(error)}
        </ReviewNote>
      ) : null}
    </ReviewCard>
  );
}
