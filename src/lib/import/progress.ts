import type { SourceRowsView } from "./rows";
import type { SkippedRow } from "./types";
import type { ImportItemView, ImportView } from "./view";

/**
 * Where an import is, as the progress bar and the raw list show it (import
 * progress spec 2026-10-27 §3.1, §6) — derived from the import and its rows,
 * nothing stored. Research and readiness need no new data: the pending
 * statuses already say it.
 *
 * Pure and client-safe: the page, the chat's card and the tests all call it.
 */

export type ImportStage = "mapping" | "reading" | "identifying" | "review" | "researching" | "done" | "failed";

export interface ImportCounts {
  /** Items the rows make — known once the rows are being written. */
  total: number;
  /** Items written so far, in any status. */
  identified: number;
  /** Rows that made no item, with a reason. */
  skipped: number;
  /** Items still to write. */
  waiting: number;
  /** Identified and not sent to research. */
  toResearch: number;
  queued: number;
  researching: number;
  researched: number;
  failed: number;
  approved: number;
  discarded: number;
}

export function importCounts(view: ImportView, items: readonly ImportItemView[]): ImportCounts {
  const by = (status: ImportItemView["status"]) => items.filter((item) => item.status === status).length;
  const identified = items.length;
  const total = Math.max(view.progress.total ?? identified, identified);
  return {
    total,
    identified,
    skipped: view.progress.skipped?.length ?? 0,
    waiting: view.status === "identifying" ? Math.max(0, total - identified) : 0,
    toResearch: by("identified"),
    queued: by("queued"),
    researching: by("researching"),
    researched: by("researched"),
    failed: by("failed"),
    approved: by("approved"),
    discarded: by("discarded"),
  };
}

export function importStage(view: ImportView, counts: ImportCounts): ImportStage {
  switch (view.status) {
    case "mapping":
      return "mapping";
    case "parsing":
      return "reading";
    case "identifying":
      return "identifying";
    case "failed":
      return "failed";
    default:
      break;
  }
  if (counts.queued + counts.researching > 0) return "researching";
  const sent = counts.researched + counts.failed + counts.approved;
  if (counts.toResearch === 0 && sent > 0) return "done";
  return "review";
}

/** Whether the page should keep asking: something is moving that nobody on the page is doing. */
export function importIsMoving(stage: ImportStage): boolean {
  return stage === "reading" || stage === "identifying" || stage === "researching";
}

/** What became of one raw row (§6's markers). */
export type RowState =
  | "waiting"
  | "identified"
  | "skipped"
  | "queued"
  | "researching"
  | "researched"
  | "failed"
  | "approved"
  | "discarded"
  /** Not an item at all — a list's heading line, a blank-named row nothing was made of. */
  | "ignored";

export interface SourceRowState {
  row: number;
  cells: string[];
  state: RowState;
  itemId: string | null;
  /** Why a skipped row made no item. */
  reason?: SkippedRow["reason"];
}

/**
 * Each raw row with its state: the item made from it (by `sourceRow`), the
 * reason it was skipped, waiting while the rows are still being written, or
 * ignored once they are done and nothing came of it.
 */
export function sourceRowStates(source: SourceRowsView, view: ImportView, items: readonly ImportItemView[]): SourceRowState[] {
  const byRow = new Map<number, ImportItemView>();
  for (const item of items) if (item.sourceRow !== null && !byRow.has(item.sourceRow)) byRow.set(item.sourceRow, item);
  const skipped = new Map<number, SkippedRow["reason"]>();
  for (const row of view.progress.skipped ?? []) if (row.sourceRow !== null) skipped.set(row.sourceRow, row.reason);
  const writing = view.status === "identifying" || view.status === "mapping" || view.status === "parsing";

  return source.rows.map(({ row, cells }) => {
    const item = byRow.get(row);
    if (item) return { row, cells, state: item.status as RowState, itemId: item.id };
    const reason = skipped.get(row);
    if (reason) return { row, cells, state: "skipped", itemId: null, reason };
    return { row, cells, state: writing ? "waiting" : "ignored", itemId: null };
  });
}

/** Rows still to do first, in source order; then the rest — the Waiting list empties as rows are identified. */
export function splitWaiting(rows: readonly SourceRowState[]): { waiting: SourceRowState[]; handled: SourceRowState[] } {
  return {
    waiting: rows.filter((row) => row.state === "waiting"),
    handled: rows.filter((row) => row.state !== "waiting"),
  };
}

/**
 * Merge a poll's changed rows into the rows the page holds, by id, keeping
 * source order — a poll answers only what changed since the last.
 */
export function mergeItems(current: readonly ImportItemView[], changed: readonly ImportItemView[]): ImportItemView[] {
  if (changed.length === 0) return [...current];
  const fresh = new Map(changed.map((item) => [item.id, item]));
  const merged = current.map((item) => fresh.get(item.id) ?? item);
  const known = new Set(current.map((item) => item.id));
  for (const item of changed) if (!known.has(item.id)) merged.push(item);
  return merged.sort((a, b) => (a.sourceRow ?? 0) - (b.sourceRow ?? 0));
}
