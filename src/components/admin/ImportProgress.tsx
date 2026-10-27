"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import {
  importCounts,
  importStage,
  sourceRowStates,
  splitWaiting,
  type ImportCounts,
  type ImportStage,
  type RowState,
  type SourceRowState,
} from "../../lib/import/progress";
import type { SourceRowsView } from "../../lib/import/rows";
import type { ImportItemView, ImportView } from "../../lib/import/view";
import { StatusGlyph, type StatusTone } from "../system/StatusGlyph";
import { cn } from "@/lib/utils";

/**
 * An import's progress (import progress spec 2026-10-27 §6): a segmented bar
 * over the import's items, one status line saying what is happening now, and
 * — at full density — the list as it was sent, each row marked with what
 * became of it. Rows still to write are listed first, under **Waiting**, and
 * leave it as they are identified; the rest fold into **Done**.
 *
 * Two densities: `full` above the review table, `compact` in the chat's card.
 * The status line is the only live region, and it changes wording only when
 * the stage changes, so a screen reader hears stages, not every tick.
 *
 * Display only: the parent holds the rows and does the polling.
 */

export interface ImportProgressProps {
  view: ImportView;
  items: readonly ImportItemView[];
  /** The raw rows, for the Source panel; null for a document or at compact density. */
  source?: SourceRowsView | null;
  density?: "full" | "compact";
  className?: string;
}

const ROW_TONE: Record<RowState, StatusTone> = {
  waiting: "idle",
  identified: "ok",
  skipped: "muted",
  queued: "idle",
  researching: "warn",
  researched: "active",
  failed: "bad",
  approved: "ok",
  discarded: "muted",
  ignored: "muted",
};

/** Rows of the Done list shown before "Show all". */
const DONE_SHOWN = 50;

export function ImportProgress({ view, items, source = null, density = "full", className }: ImportProgressProps) {
  const t = useTranslations("admin.import.progress");
  const counts = useMemo(() => importCounts(view, items), [view, items]);
  const stage = importStage(view, counts);
  const rows = useMemo(() => (source ? sourceRowStates(source, view, items) : null), [source, view, items]);

  if (stage === "mapping" || stage === "failed") return null;

  return (
    <div className={cn("ui flex flex-col gap-2", className)} data-stage={stage}>
      <p role="status" aria-live="polite" className="m-0 text-sm text-foreground">
        {stageLine(t, stage, counts, view)}
      </p>
      <ProgressBar t={t} stage={stage} counts={counts} view={view} />
      {density === "full" ? <StageSteps t={t} stage={stage} counts={counts} view={view} /> : null}
      {density === "full" && rows && rows.length > 0 ? <SourcePanel t={t} rows={rows} source={source!} stage={stage} /> : null}
    </div>
  );
}

type T = ReturnType<typeof useTranslations<"admin.import.progress">>;

function stageLine(t: T, stage: ImportStage, counts: ImportCounts, view: ImportView): string {
  switch (stage) {
    case "reading":
      return view.progress.chunks
        ? t("line.readingParts", { done: view.progress.chunksDone ?? 0, parts: view.progress.chunks })
        : t("line.reading");
    case "identifying":
      return t("line.identifying", { done: counts.identified, total: counts.total });
    case "researching":
      return t("line.researching", { running: counts.researching, queued: counts.queued, ready: counts.researched });
    case "done":
      return t("line.done", { ready: counts.researched, failed: counts.failed, approved: counts.approved });
    default:
      return t("line.review", { items: counts.identified - counts.discarded, duplicates: view.duplicateCount, skipped: counts.skipped });
  }
}

/** How far the current stage is, 0–100, for the bar's `aria-valuenow`. */
function stagePercent(stage: ImportStage, counts: ImportCounts, view: ImportView): number {
  const ratio = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
  if (stage === "reading") return ratio(view.progress.chunksDone ?? 0, view.progress.chunks ?? 0);
  if (stage === "identifying") return ratio(counts.identified, counts.total);
  const sent = counts.queued + counts.researching + counts.researched + counts.failed + counts.approved;
  if (stage === "researching" || stage === "done") return ratio(counts.researched + counts.failed + counts.approved, sent);
  return 100;
}

function ProgressBar({ t, stage, counts, view }: { t: T; stage: ImportStage; counts: ImportCounts; view: ImportView }) {
  const whole = Math.max(counts.total, 1);
  const width = (n: number) => `${Math.min(100, (n / whole) * 100)}%`;
  const ready = counts.researched + counts.approved;
  const running = counts.queued + counts.researching;
  const identified = counts.toResearch;
  // A document's parts read, before any row exists.
  const reading = stage === "reading" && view.progress.chunks ? ((view.progress.chunksDone ?? 0) / view.progress.chunks) * 100 : null;
  const percent = stagePercent(stage, counts, view);

  return (
    <div
      role="progressbar"
      aria-label={t(`stage.${stage}`)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={t("percent", { percent })}
      className="flex h-2 w-full overflow-hidden border border-border bg-muted"
    >
      {reading !== null ? (
        <span data-segment="reading" className="h-full bg-foreground/60" style={{ width: `${reading}%` }} />
      ) : (
        <>
          <span data-segment="ready" className="h-full bg-primary" style={{ width: width(ready) }} />
          <span data-segment="running" className="h-full bg-warn" style={{ width: width(running) }} />
          <span data-segment="failed" className="h-full bg-bad" style={{ width: width(counts.failed) }} />
          <span data-segment="identified" className="h-full bg-foreground/60" style={{ width: width(identified) }} />
        </>
      )}
    </div>
  );
}

function StageSteps({ t, stage, counts, view }: { t: T; stage: ImportStage; counts: ImportCounts; view: ImportView }) {
  const read = stage !== "reading";
  const identifiedDone = read && stage !== "identifying";
  const steps: { key: string; tone: StatusTone; label: string }[] = [
    { key: "read", tone: read ? "ok" : "warn", label: t("step.read", { rows: view.rowCount || counts.total }) },
    {
      key: "identified",
      tone: identifiedDone ? "ok" : read ? "warn" : "idle",
      label: t("step.identified", { done: counts.identified, total: counts.total, skipped: counts.skipped }),
    },
    {
      key: "researching",
      tone: counts.queued + counts.researching > 0 ? "warn" : "idle",
      label: t("step.researching", { count: counts.queued + counts.researching }),
    },
    {
      key: "ready",
      tone: counts.researched > 0 ? "active" : "idle",
      label: t("step.ready", { count: counts.researched, failed: counts.failed }),
    },
  ];
  return (
    <ol className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0" aria-label={t("stepsLabel")}>
      {steps.map((step) => (
        <li key={step.key}>
          <StatusGlyph tone={step.tone} label={step.label} />
        </li>
      ))}
    </ol>
  );
}

function SourcePanel({ t, rows, source, stage }: { t: T; rows: SourceRowState[]; source: SourceRowsView; stage: ImportStage }) {
  const { waiting, handled } = splitWaiting(rows);
  // Open while rows are being written; folded once review starts (§11 Q3).
  const open = stage === "identifying" || stage === "reading";
  return (
    <details className="border border-border bg-card" open={open}>
      <summary className="cursor-pointer px-3 py-2 font-mono text-label tracking-[0.08em] uppercase">
        {t("source.title", { rows: rows.length + source.hidden })}
      </summary>
      <div className="flex flex-col gap-3 px-3 pb-3">
        {source.headers ? (
          <p className="m-0 font-mono text-xs text-muted-foreground">{source.headers.join(" · ")}</p>
        ) : null}
        {waiting.length > 0 ? (
          <section aria-label={t("source.waiting", { count: waiting.length })}>
            <h4 className="m-0 mb-1 font-mono text-label tracking-[0.08em] text-muted-foreground uppercase">
              {t("source.waiting", { count: waiting.length })}
            </h4>
            <RowList t={t} rows={waiting} />
          </section>
        ) : null}
        {handled.length > 0 ? (
          <details open={waiting.length === 0 && handled.length <= DONE_SHOWN}>
            <summary className="cursor-pointer font-mono text-label tracking-[0.08em] text-muted-foreground uppercase">
              {t("source.done", { count: handled.length })}
            </summary>
            <RowList t={t} rows={handled} />
          </details>
        ) : null}
        {source.hidden > 0 ? <p className="m-0 text-xs text-muted-foreground">{t("source.hidden", { count: source.hidden })}</p> : null}
      </div>
    </details>
  );
}

function RowList({ t, rows }: { t: T; rows: SourceRowState[] }) {
  return (
    <ul className="m-0 flex max-h-80 list-none flex-col gap-0.5 overflow-y-auto p-0">
      {rows.map((row) => (
        <li key={row.row} data-row={row.row} data-state={row.state} className="flex items-baseline gap-2 text-xs">
          <span className="w-10 shrink-0 font-mono text-muted-foreground tabular-nums">{row.row}</span>
          <span className={cn("min-w-0 flex-1 truncate font-mono", (row.state === "skipped" || row.state === "discarded") && "line-through")}>
            {row.cells.filter(Boolean).join(" · ")}
          </span>
          {/* The word is shown where it says something the glyph cannot: why, or what to do next. */}
          <StatusGlyph
            compact={!(row.state === "skipped" || row.state === "failed" || row.state === "researched")}
            tone={ROW_TONE[row.state]}
            label={rowLabel(t, row)}
            className="shrink-0"
          />
        </li>
      ))}
    </ul>
  );
}

function rowLabel(t: T, row: SourceRowState): string {
  if (row.state === "skipped") return t(`row.skipped.${row.reason ?? "no_name"}`);
  return t(`row.${row.state}`);
}
