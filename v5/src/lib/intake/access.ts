import { can, type Permission } from "../auth/permissions";
import type { Role } from "../auth/roles";
import type { DuplicateResolution, PendingStatus } from "../db/schema/vocabulary";
import { RESEARCH_START_STALE_MS } from "./limits";

/**
 * Who may act on a pending item, and which items may be researched (spec §5.4,
 * §8).
 *
 * Client-safe on purpose — `permissions.ts` is pure data — so the card and the
 * intake pages hide the controls with exactly the rule the routes enforce.
 * Hiding is presentation; the route's call to these same functions is the
 * control.
 */

/** What `/admin/intake` and its preliminary pages require. */
export const INTAKE_REVIEW_PERMISSION: Permission = "tools.approve";

type Subject = { role: Role | null | undefined; userId?: string | null } | null | undefined;

/**
 * May `subject` edit, discard or research `item`?
 *
 * `tools.add` always, and then either the item is theirs or they hold
 * `tools.approve` (§5.4 step 6: "every item belongs to a batch the caller
 * created or the caller holds `tools.approve`"). A missing user id never
 * matches an owner, so an identity with no id can only get through as an
 * approver.
 */
export function canActOnPendingTool(subject: Subject, item: { createdBy: string }): boolean {
  if (!can(subject, "tools.add")) return false;
  const userId = subject?.userId;
  if (typeof userId === "string" && userId !== "" && item.createdBy === userId) return true;
  return can(subject, "tools.approve");
}

export interface ResearchableItem {
  status: PendingStatus;
  workflowRunId: string | null;
  duplicateResolution: DuplicateResolution | null;
  duplicateOfToolId?: string | null;
  duplicateOfPendingId?: string | null;
  researchError?: string | null;
  researchRequestedAt?: Date | string | null;
}

/** What {@link hasStalledStart} needs — a stored row or a browser's view of one. */
export interface StartState {
  status: PendingStatus;
  /** Whether a workflow run holds the item. */
  hasWorkflowRun: boolean;
  researchError?: string | null;
  researchRequestedAt?: Date | string | null;
}

/**
 * Queued, but nothing is running for it and nothing is about to: its start
 * failed and said so (`research_error`), or it has sat with no run for
 * `RESEARCH_START_STALE_MS` — the request died between queueing and `start()`,
 * or could not even record why `start()` failed.
 *
 * Such an item is waiting for somebody to press Retry, and the pages offer it
 * (§5.4 unhappy paths). A queued item with no run that is *younger* than that
 * belongs to a request that is starting it right now, and is left alone.
 * `queueForResearch` restates this in SQL; the two must agree.
 */
export function hasStalledStart(item: StartState, now: number = Date.now()): boolean {
  if (item.status !== "queued" || item.hasWorkflowRun) return false;
  if (item.researchError) return true;
  if (!item.researchRequestedAt) return true;
  const requested = new Date(item.researchRequestedAt).getTime();
  return !Number.isFinite(requested) || now - requested >= RESEARCH_START_STALE_MS;
}

/**
 * Could this item be sent to research now?
 *
 * Identified, researched and failed items can (the last two are **Research
 * again**), and so can a queued item whose start stalled
 * ({@link hasStalledStart}) — the same Research press retries it (§5.4 unhappy
 * paths). A queued item with no run that a request is starting right now
 * cannot: taking it would start a second run. A discarded-by-resolution item
 * cannot. Whether a duplicate still needs a decision is a separate question:
 * {@link hasUnresolvedDuplicate}.
 */
export function isResearchable(item: ResearchableItem, now: number = Date.now()): boolean {
  if (item.duplicateResolution === "discard") return false;
  if (item.status === "identified" || item.status === "researched" || item.status === "failed") {
    return true;
  }
  return hasStalledStart({ ...item, hasWorkflowRun: item.workflowRunId !== null }, now);
}

/** The duplicate check matched something and nobody has said what to do about it. */
export function hasUnresolvedDuplicate(item: {
  duplicateOfToolId?: string | null;
  duplicateOfPendingId?: string | null;
  duplicateResolution: DuplicateResolution | null;
}): boolean {
  return Boolean(item.duplicateOfToolId || item.duplicateOfPendingId) && item.duplicateResolution === null;
}
