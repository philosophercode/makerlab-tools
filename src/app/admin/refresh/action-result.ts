import type { AdminActionWarning, AdminGateError } from "../../../lib/admin/action-result";
import type { InventoryWriteWarning } from "../../../lib/inventory/result";

/**
 * What `/admin/refresh`'s and the inventory's refresh actions answer (refresh
 * research spec §5, §6). Directive-free, like every admin surface's result
 * module: the client islands render these codes without importing the
 * endpoints. Every code has an `admin.errors.<code>` message.
 */

export const ADMIN_REFRESH_PATH = "/admin/refresh";

export function refreshItemPath(id: string): string {
  return `${ADMIN_REFRESH_PATH}/${id}`;
}

/**
 * - `conflict` — the tool changed since the proposals were made; nothing was
 *   written, and the cards now show the record's values.
 * - `stale_refresh` — somebody else decided cards on this refresh meanwhile;
 *   reload.
 * - `unverified_quote` — no quote was found on the page: open the editor.
 * - `replaces_lab_rule` — accepting would remove or replace a lab rule
 *   (restrictions, training); research may only add to them.
 * - `duplicate_name` — the display name is another tool's (amendment 2026-09-25).
 * - `daily_limit`, `start_failed`, `too_many_tools` — queueing.
 */
export type RefreshWriteError =
  | "conflict"
  | "not_found"
  | "invalid_field"
  | "not_editable"
  | "stale_refresh"
  | "unverified_quote"
  | "replaces_lab_rule"
  | "duplicate_name"
  | "daily_limit"
  | "start_failed"
  | "too_many_tools";

export type RefreshActionError = AdminGateError | RefreshWriteError;

export type RefreshWarning = AdminActionWarning | InventoryWriteWarning;

/** **Refresh research (N)** pressed. */
export type QueueRefreshResult =
  | { ok: true; queued: number; skipped: number; missing: number }
  | { ok: false; error: RefreshActionError; remaining?: number };

export interface QueueRefreshInput {
  toolIds: string[];
  includeDescription: boolean;
  /** One tool only (§5.1). */
  note: string | null;
}

export type QueueRefreshAction = (input: QueueRefreshInput) => Promise<QueueRefreshResult>;

/** What a decision answers: success (maybe with a warning), or why nothing moved. */
export type DecideRefreshResult =
  | { ok: true; applied: number; warning?: RefreshWarning; conflict?: boolean }
  | { ok: false; error: RefreshActionError };

export interface DecideRefreshInput {
  refreshId: string;
  /** The refresh row's revision the page was rendered with. */
  rowRevision: string;
  decision: "accept" | "reject" | "accept_all_verified" | "reject_all";
  /** The cards, for `accept` / `reject`. */
  ids?: string[];
}

export type DecideRefreshAction = (input: DecideRefreshInput) => Promise<DecideRefreshResult>;

export interface RefreshAgainInput {
  refreshId: string;
  note: string | null;
  includeDescription: boolean;
}

export type RefreshAgainAction = (input: RefreshAgainInput) => Promise<QueueRefreshResult>;

/** The review page's bundle, built by the page (a `"use server"` module exports only functions). */
export interface RefreshReviewActions {
  decide: DecideRefreshAction;
  again: RefreshAgainAction;
}
