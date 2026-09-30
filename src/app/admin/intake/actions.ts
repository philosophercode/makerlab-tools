"use server";

import {
  PENDING_ADD_UNIT,
  PENDING_APPROVE,
  PENDING_DIFFERENT_IMAGE,
  PENDING_DISCARD,
  PENDING_SAVE_IDENTITY,
} from "../../../lib/actions/intake";
import { performAction } from "../../../lib/actions/perform";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import type {
  ApprovePendingActionInput,
  IntakeActionResult,
  IntakeApproveResult,
} from "./action-result";

/**
 * The review queue's endpoints (spec §5.4 steps 10–12, §8, Article 5) —
 * one-line wrappers over `pending.*` (`src/lib/actions/intake.ts`,
 * assistant–GUI parity spec §9 phase 5), so the assistant's cards run the
 * same gate, parse, checks and audit as these buttons.
 *
 * - **Approve** publishes, so it needs `tools.publish` as well as
 *   `tools.approve` (the definition's `check`). **Approve as draft**, **Add
 *   unit**, **Discard** and the name/brand **Save** need `tools.approve`.
 * - **Every input is parsed** by the definition, because a server action's
 *   arguments are whatever the POST body said; a shape that does not parse is
 *   `invalid_field` and reaches nothing. `publish` is set here, after the
 *   body, so a body cannot choose it (the cast only names the spread's type;
 *   the definition's strict schema decides what the body was).
 * - **Refusals are values**, rendered from `admin.errors.<code>`; a thrown
 *   error becomes `failed`. A success refreshes the queue and the item's page.
 *
 * Only async exports: the result types and the path live in
 * `./action-result.ts`.
 */

/** **Approve** — creates the tool, published (§5.4 step 11). */
export async function approvePending(input: unknown): Promise<IntakeApproveResult> {
  return performAction(PENDING_APPROVE, { ...(input as ApprovePendingActionInput), publish: true }, await resolveIdentityFromHeaders(), { surface: "gui" });
}

/** **Approve as draft** — the same, unpublished, for finishing in the editor. */
export async function approvePendingAsDraft(input: unknown): Promise<IntakeApproveResult> {
  return performAction(PENDING_APPROVE, { ...(input as ApprovePendingActionInput), publish: false }, await resolveIdentityFromHeaders(), { surface: "gui" });
}

/** **Add unit** — an add-unit item becomes another unit of the tool it matched. */
export async function addPendingUnit(input: unknown): Promise<IntakeApproveResult> {
  return performAction(PENDING_ADD_UNIT, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}

/**
 * **Discard** — the item leaves the queue and its photos are released for the
 * nightly sweep. Not audited: `AUDIT_ACTIONS` has no event for it (§4.11), and
 * nothing reached the catalogue.
 */
export async function discardPending(input: unknown): Promise<IntakeActionResult> {
  return performAction(PENDING_DISCARD, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}

/**
 * The name/brand **Save** on the preliminary page. Goes through
 * `updatePendingTool`, which re-runs the duplicate check when either changes —
 * a corrected model name is exactly when a match appears or disappears.
 */
export async function savePendingIdentity(input: unknown): Promise<IntakeActionResult> {
  return performAction(PENDING_SAVE_IDENTITY, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}

/**
 * **Find a different image** — the image stage alone, again, for a researched
 * item, with the reviewer's optional note. `tools.approve`, like the page.
 * Costs one against the caller's daily research allowance (`daily_limit` past
 * it), refuses while a run is already going (`image_retry_running`) and says
 * `start_failed` when the workflow would not start. The page polls for the
 * result.
 */
export async function requestDifferentImage(input: unknown): Promise<IntakeActionResult> {
  return performAction(PENDING_DIFFERENT_IMAGE, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}
