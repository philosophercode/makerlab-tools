import type { AdminActionWarning, AdminGateError } from "../../../lib/admin/action-result";
import type { ApprovalFields } from "../../../lib/data/pending-tools";
import type { IntakeApprovalError } from "../../../lib/intake/approve";
import { ADMIN_INTAKE_PATH } from "../../../lib/intake/types";

/**
 * What `/admin/intake`'s server actions answer, and where they live.
 *
 * Directive-free for the reason every admin surface's result module is: a
 * `"use server"` module may export only async functions, and the preliminary
 * page — a client island — has to render these codes without importing the
 * endpoints to get at their shape. Every import here is type-only apart from
 * the path, which comes from the client-safe `lib/intake/types.ts`.
 */

/** The review queue, and the path every action refreshes. */
export { ADMIN_INTAKE_PATH };

/** One item's preliminary page. */
export function intakeItemPath(id: string): string {
  return `${ADMIN_INTAKE_PATH}/${id}`;
}

/**
 * Why an intake write did nothing. Every code has an `admin.errors.<code>`
 * message, so the page renders these exactly as the other admin surfaces do.
 *
 * The approval codes come from `lib/intake/approve.ts`, unrenamed. `not_found`
 * and `not_editable` are also what a discard or a rename answers — the item is
 * gone, or has moved on to researching, approved or discarded.
 */
export type IntakeWriteError = IntakeApprovalError | ImageRetryError;

/**
 * What **Find a different image** can answer besides the shared codes: a run
 * is already going, the day's research allowance is spent, or the workflow
 * would not start.
 */
export type ImageRetryError = "image_retry_running" | "daily_limit" | "start_failed";

export type IntakeActionError = AdminGateError | IntakeWriteError;

/** A write that changed a pending item and created nothing. */
export type IntakeActionResult =
  { ok: true; warning?: AdminActionWarning } | { ok: false; error: IntakeActionError };

/**
 * An approval that created catalogue: where the tool now lives, and whether
 * the public can see it yet. A lost audit event rides on `ok: true` as
 * `warning` — the tool exists either way (§4.11) — and so does a product image
 * that did not attach (`image_not_attached`, gateway spec §5.2). When both
 * happen the audit wins the slot, and `imageAttached: false` still says the
 * image is missing.
 */
export type IntakeApproveResult =
  | {
      ok: true;
      toolId: string;
      slug: string;
      published: boolean;
      warning?: AdminActionWarning;
      imageAttached?: boolean;
    }
  | { ok: false; error: IntakeActionError };

/** The preliminary page's form, sent with **Approve** or **Approve as draft**. */
export interface ApprovePendingActionInput {
  id: string;
  fields: ApprovalFields;
  /** The "I've checked this" note — required, non-blank, at low confidence. */
  overrideNote?: string | null;
}

export type ApprovePendingAction = (
  input: ApprovePendingActionInput
) => Promise<IntakeApproveResult>;

export type AddPendingUnitAction = (input: {
  id: string;
  serialNumber: string | null;
}) => Promise<IntakeApproveResult>;

export type DiscardPendingAction = (input: { id: string }) => Promise<IntakeActionResult>;

export type RequestDifferentImageAction = (input: { id: string; note: string | null }) => Promise<IntakeActionResult>;

export type SavePendingIdentityAction = (input: {
  id: string;
  name: string;
  brand: string | null;
}) => Promise<IntakeActionResult>;

/**
 * The bundle `PreliminaryToolPage` receives. Built by the page rather than
 * exported from `actions.ts`, because a `"use server"` module may export only
 * async functions.
 */
export interface IntakeActions {
  approve: ApprovePendingAction;
  approveAsDraft: ApprovePendingAction;
  addUnit: AddPendingUnitAction;
  discard: DiscardPendingAction;
  saveIdentity: SavePendingIdentityAction;
  /** **Find a different image** — optional so a page built before it still renders. */
  differentImage?: RequestDifferentImageAction;
}
