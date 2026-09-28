"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { GapDecisionAction } from "../../../app/admin/insights/action-result";
import { isoDay } from "../../../lib/iso-day";
import type { GapRow } from "../../../lib/usage/queries";
import { AsyncButton } from "../../system/AsyncButton";
import { EmptyState } from "../../system/EmptyState";
import { Button } from "@/components/ui/button";

/**
 * The **Unanswered** queue (usage insight spec §6): each question the
 * assistant could not answer, once, with how often it was asked, the tool,
 * why it could not be answered and when it was last asked. From the row:
 *
 * - **Add a manual** — the tool's page, where the editor's Resources section
 *   is (only when the question was about a tool);
 * - **File as a correction** — `insights.file_correction`, which lands it on
 *   `/admin/corrections`;
 * - **Dismiss** — `insights.dismiss_gap`; three more askings reopen it.
 *
 * The question is student text: rendered as text, never HTML or Markdown.
 * Actions pass down as props (they are server actions); a decided row stays,
 * muted, saying what happened, until the page is next loaded.
 */
export function UnansweredQueue({
  gaps,
  fileCorrection,
  dismiss,
}: {
  gaps: GapRow[];
  fileCorrection: GapDecisionAction;
  dismiss: GapDecisionAction;
}) {
  const t = useTranslations("admin.insights.gaps");
  const tErrors = useTranslations("admin.errors");
  const [decided, setDecided] = useState<Record<string, "filed" | "dismissed">>({});

  if (gaps.length === 0) return <EmptyState>{t("empty")}</EmptyState>;

  const run = async (gap: GapRow, action: GapDecisionAction, outcome: "filed" | "dismissed") => {
    try {
      const result = await action({ gapId: gap.id });
      if (!result.ok) return tErrors(result.error);
      setDecided((current) => ({ ...current, [gap.id]: outcome }));
      return true;
    } catch {
      return tErrors("failed");
    }
  };

  return (
    <ul aria-label={t("listLabel")} data-slot="unanswered-queue" className="ui m-0 flex list-none flex-col border-t border-rule p-0">
      {gaps.map((gap) => {
        const state = decided[gap.id];
        return (
          <li key={gap.id} data-gap-id={gap.id} data-decided={state} className="flex flex-col gap-2 border-b border-rule py-3 sm:flex-row sm:items-start sm:justify-between">
            <div className={`flex min-w-0 flex-col gap-1 ${state ? "opacity-60" : ""}`}>
              <p className="m-0 border-s-2 border-rule ps-3 text-sm break-words whitespace-pre-wrap">{gap.question}</p>
              <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                <span className="border border-rule px-1.5 font-mono text-[11px] tracking-[0.04em] uppercase">{t(`kind.${gap.kind}`)}</span>
                {gap.toolSlug ? (
                  <Link href={`/tools/${gap.toolSlug}`} className="hover:text-primary-ink hover:underline">
                    {gap.toolName}
                  </Link>
                ) : null}
                <span className="tabular-nums">{t("asked", { count: gap.occurrences })}</span>
                <span className="tabular-nums">{t("lastSeen", { date: isoDay(gap.lastSeen) })}</span>
                <span role="status" className="font-medium text-foreground">
                  {state === "filed" ? t("filedMessage") : state === "dismissed" ? t("dismissedMessage") : null}
                </span>
              </p>
            </div>
            {state ? null : (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {gap.toolSlug ? (
                  <Button asChild size="xs">
                    <Link href={`/tools/${gap.toolSlug}`} aria-label={t("addManualFor", { tool: gap.toolName ?? "" })}>
                      {t("addManual")}
                    </Link>
                  </Button>
                ) : null}
                <AsyncButton
                  size="xs"
                  aria-label={t("fileCorrectionFor", { question: gap.question.slice(0, 60) })}
                  doneLabel={t("filed")}
                  doneMessage={t("filedMessage")}
                  onRun={() => run(gap, fileCorrection, "filed")}
                >
                  {t("fileCorrection")}
                </AsyncButton>
                <AsyncButton
                  size="xs"
                  variant="ghost"
                  aria-label={t("dismissFor", { question: gap.question.slice(0, 60) })}
                  doneLabel={t("dismissed")}
                  doneMessage={t("dismissedMessage")}
                  onRun={() => run(gap, dismiss, "dismissed")}
                >
                  {t("dismiss")}
                </AsyncButton>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
