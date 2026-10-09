import type { DriftedField } from "../../lib/actions/staleness";
import type { TriageTool } from "../../lib/actions/manual-triage";

/**
 * The Manuals view's decisions, as data (assistant–GUI parity spec, amendment
 * 2026-10-07): which rows are still to decide, what a click sends, and which
 * tool comes next. Pure, so the component only wires clicks and keys to it.
 *
 * **Why "chosen".** Proposals for one tool must be confirmed in one request to
 * confirm in order without conflicting (`revision-chain.ts`). So on a tool
 * with several rows, **Confirm** on a row marks it chosen, and the chosen rows
 * are sent together once no row of that tool is left undecided (or at once
 * with **Confirm all for this tool**). On a tool with one row, Confirm sends
 * at once. **Dismiss** always sends at once: a dismissal never changes the
 * tool, so it cannot make another row conflict.
 */

export type TriageRowStatus =
  | "open"
  | "chosen"
  | "sending"
  | "confirmed"
  | "cancelled"
  | "conflict"
  | "failed"
  | "expired"
  | "already_decided"
  | "not_found";

export interface TriageRowState {
  status: TriageRowStatus;
  error?: string;
  drifted?: DriftedField[];
}

export type TriageRows = Record<string, TriageRowState>;

/** The confirm route's per-row answer. `open`: the request ran out of time before this row. */
export interface TriageOutcome {
  id: string;
  status: Exclude<TriageRowStatus, "chosen" | "sending">;
  error?: string;
  drifted?: DriftedField[];
}

/** At most this many ids per request (the route's limit). */
export const MAX_IDS = 20;

const UNDECIDED: ReadonlySet<TriageRowStatus> = new Set(["open", "chosen", "sending"]);

export function initialRows(tools: readonly TriageTool[], now = Date.now()): TriageRows {
  const rows: TriageRows = {};
  for (const tool of tools) {
    for (const p of tool.proposals) rows[p.id] = { status: Date.parse(p.expiresAt) <= now ? "expired" : "open" };
  }
  return rows;
}

const statusOf = (rows: TriageRows, id: string): TriageRowStatus => rows[id]?.status ?? "open";

/** A tool is decided when none of its rows waits for anything. */
export function isDecided(tool: TriageTool, rows: TriageRows): boolean {
  return tool.proposals.every((p) => !UNDECIDED.has(statusOf(rows, p.id)));
}

export function isBusy(tool: TriageTool, rows: TriageRows): boolean {
  return tool.proposals.some((p) => statusOf(rows, p.id) === "sending");
}

export function decidedCount(tools: readonly TriageTool[], rows: TriageRows): number {
  return tools.filter((tool) => isDecided(tool, rows)).length;
}

/** The next undecided tool after `from`, wrapping round; null when every tool is decided. */
export function nextUndecided(tools: readonly TriageTool[], rows: TriageRows, from: number): number | null {
  for (let step = 1; step <= tools.length; step += 1) {
    const at = (((from + step) % tools.length) + tools.length) % tools.length;
    if (!isDecided(tools[at], rows)) return at;
  }
  return null;
}

/** Every row of the tool still open or chosen, in proposal order: what "Confirm all for this tool" sends. */
export function confirmableIds(tool: TriageTool, rows: TriageRows): string[] {
  return tool.proposals
    .filter((p) => {
      const status = statusOf(rows, p.id);
      return status === "open" || status === "chosen";
    })
    .map((p) => p.id)
    .slice(0, MAX_IDS);
}

/**
 * What **Confirm** on one row does: mark it chosen while other rows of its
 * tool are still open, or send it now with the tool's chosen rows.
 */
export function planRowConfirm(tool: TriageTool, rows: TriageRows, id: string): { send: string[] } | { choose: string } {
  const othersOpen = tool.proposals.some((p) => p.id !== id && statusOf(rows, p.id) === "open");
  if (othersOpen) return { choose: id };
  return {
    send: tool.proposals
      .filter((p) => p.id === id || statusOf(rows, p.id) === "chosen")
      .map((p) => p.id)
      .slice(0, MAX_IDS),
  };
}

/** After rows were dismissed: the chosen rows to send now, when nothing of the tool is left open. */
export function chosenReady(tool: TriageTool, rows: TriageRows): string[] {
  if (tool.proposals.some((p) => statusOf(rows, p.id) === "open")) return [];
  return tool.proposals
    .filter((p) => statusOf(rows, p.id) === "chosen")
    .map((p) => p.id)
    .slice(0, MAX_IDS);
}

export function withStatus(rows: TriageRows, ids: readonly string[], status: TriageRowStatus): TriageRows {
  return { ...rows, ...Object.fromEntries(ids.map((id) => [id, { status }])) };
}

export function withOutcomes(rows: TriageRows, outcomes: readonly TriageOutcome[]): TriageRows {
  const next = { ...rows };
  for (const outcome of outcomes) {
    next[outcome.id] = {
      // Not reached before the request's time ran out: still open, nothing changed.
      status: outcome.status,
      ...(outcome.error ? { error: outcome.error } : {}),
      ...(outcome.drifted ? { drifted: outcome.drifted } : {}),
    };
  }
  return next;
}
