"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { CompleteScheduleAction } from "../../app/admin/maintenance/schedule-result";
import type { DueItem } from "../../lib/data/maintenance-schedules";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "../system/EmptyState";
import { StatusGlyph } from "../system/StatusGlyph";
import { ReviewCard, ReviewNote } from "../system/review/ReviewCard";
import { DUE_TONE, dueLabel, everyLabel, whereLabel } from "./schedule-labels";
import { TaskDoneControl } from "./TaskDoneControl";
import { useRefreshNudge } from "./use-refresh-nudge";

/**
 * **Recurring tasks due**, at the top of `/admin/maintenance` (recurring
 * maintenance spec, amendment 2026-10-06): the routine upkeep that is overdue
 * or due within a week, oldest first, each with **Done** under it. The ticket
 * queue below stays for reported problems.
 *
 * Three empty states, each saying what to do next: no tasks set up yet (the
 * link sets them up), nothing due this week, and the list itself. A
 * check-off is confirmed here, above the list, because the row it came from
 * leaves the list when the page re-renders.
 */

export interface DueTasksProps {
  items: DueItem[];
  /** The lab's today, `YYYY-MM-DD`. */
  today: string;
  /** Any active task set up at all — decides which empty state to say. */
  hasSchedules: boolean;
  action: CompleteScheduleAction;
  schedulesHref: string;
}

export function DueTasks({ items, today, hasSchedules, action, schedulesHref }: DueTasksProps) {
  const t = useTranslations("admin.schedules");
  const tw = useTranslations("admin.warnings");
  const nudge = useRefreshNudge();
  const [lastDone, setLastDone] = useState<{ title: string; nextDueOn: string; unaudited: boolean } | null>(null);

  const manage = (
    <Link href={schedulesHref} className={buttonVariants({ size: "sm", variant: "quiet" })}>
      {hasSchedules ? t("manage") : t("due.setUp")}
    </Link>
  );

  return (
    <section id="due-tasks" aria-labelledby="due-tasks-heading" className="ui flex flex-col gap-2">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h3 id="due-tasks-heading" className="m-0 font-mono text-label font-medium tracking-[0.08em] uppercase">
            {t("due.heading")}
          </h3>
          <p className="m-0 max-w-[72ch] text-sm text-muted-foreground">{t("due.lede")}</p>
        </div>
        {hasSchedules ? manage : null}
      </header>

      {lastDone ? (
        <ReviewNote role="status" tone={lastDone.unaudited ? "warn" : "ink"}>
          {lastDone.unaudited ? tw("audit_unavailable") : t("doneSaved", { title: lastDone.title, date: lastDone.nextDueOn })}
        </ReviewNote>
      ) : null}

      {!hasSchedules ? (
        <EmptyState action={manage}>{t("due.noneYet")}</EmptyState>
      ) : items.length === 0 ? (
        <EmptyState>{t("due.nothingDue")}</EmptyState>
      ) : (
        <ul aria-label={t("due.heading")} className="m-0 flex list-none flex-col p-0">
          {items.map((item) => {
            const due = dueLabel(t, item.nextDueOn, today);
            return (
              <li key={item.id}>
                <ReviewCard
                  label={item.title}
                  headingLevel={4}
                  tone={due.state === "overdue" ? "safety" : due.state === "today" ? "warn" : "default"}
                  marks={<StatusGlyph tone={DUE_TONE[due.state]} label={due.text} />}
                  meta={
                    <>
                      {item.toolSlug ? (
                        <Link className="text-primary-ink hover:underline" href={`/tools/${item.toolSlug}`}>
                          {whereLabel(t, item)}
                        </Link>
                      ) : (
                        <span>{whereLabel(t, item)}</span>
                      )}
                      <span>{everyLabel(t, item.interval)}</span>
                      <span className="tabular-nums">{t("dueOn", { date: item.nextDueOn })}</span>
                      <span className="tabular-nums">{item.lastDoneOn ? t("lastDone", { date: item.lastDoneOn }) : t("neverDone")}</span>
                    </>
                  }
                >
                  {item.instructions ? (
                    <p className="m-0 max-w-[78ch] text-sm leading-relaxed whitespace-pre-wrap">{item.instructions}</p>
                  ) : null}
                  <TaskDoneControl
                    scheduleId={item.id}
                    title={item.title}
                    dueOn={item.nextDueOn}
                    action={action}
                    onDone={(result) => {
                      setLastDone(result);
                      nudge();
                    }}
                  />
                </ReviewCard>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
