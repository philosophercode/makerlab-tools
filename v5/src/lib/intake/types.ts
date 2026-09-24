import type { IntakeConfidenceLevel } from "../capabilities/types";
import type { DuplicateResolution, PendingStatus } from "../db/schema/vocabulary";

/**
 * The shapes the two-step add-tool flow passes between server and browser
 * (spec §5.4, §6).
 *
 * **Client-safe, and it has to stay that way.** The intake table card in the
 * chat, the `/admin/intake` pages and the pending-tools routes all speak these
 * types, and two of those three are client components. Every import here is
 * `import type`, so nothing from the database layer or the auth layer reaches a
 * browser bundle.
 *
 * Refusals travel as **codes**, never as sentences: a client renders
 * `intake.table.errors.<code>` or `admin.intake.errors.<code>`, and the English
 * `error` on {@link PendingApiError} is only a fallback for a caller with no
 * messages loaded (Article 6).
 */

export type { DuplicateResolution, PendingStatus };

/** Where the review queue lives — linked from the chat card once research starts. */
export const ADMIN_INTAKE_PATH = "/admin/intake";

/**
 * What the duplicate check matched: a tool already in the catalogue (published
 * or a draft), or another pending item somebody is still working on.
 */
export type DuplicateOf =
  | { kind: "tool"; id: string; name: string; slug: string; published: boolean }
  | { kind: "pending"; id: string; name: string; status: PendingStatus };

/** One photo on a pending item. `url` is null for a private blob — say so, never guess. */
export interface PendingToolPhotoView {
  attachmentId: string;
  url: string | null;
  filename: string | null;
}

/** A pending item as a browser sees it. Dates are ISO strings; no ids of people. */
export interface PendingToolView {
  id: string;
  batchId: string;
  status: PendingStatus;
  name: string;
  brand: string | null;
  categoryHint: string | null;
  locationHint: string | null;
  serialNumber: string | null;
  duplicateOf: DuplicateOf | null;
  duplicateResolution: DuplicateResolution | null;
  photos: PendingToolPhotoView[];
  /** The research grade, once there is research. Null before, and for add-unit items. */
  confidenceLevel: IntakeConfidenceLevel | null;
  researchError: string | null;
  /** When research was last asked for, or null if it never was. */
  researchRequestedAt: string | null;
  /** Whether a workflow run holds the item — with the above, tells a stalled start from one under way. */
  hasWorkflowRun: boolean;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Something `identify_tools` got partly right, raised as a message key.
 *
 * - `photos_not_attached` — some photo ids named no unclaimed upload (swept,
 *   or somebody else's), so fewer photos are on the rows than were sent.
 * - `photos_not_public` — the photos are attached but private, so the card
 *   cannot show them yet.
 * - `photos_unassigned` — photos sent this turn that the model matched to no
 *   item, so nothing claimed them.
 */
export type IntakeTableWarning = "photos_not_attached" | "photos_not_public" | "photos_unassigned";

/** The `data-intake-table` stream part `identify_tools` writes (§5.4 step 4). */
export interface IntakeTablePayload {
  kind: "intake-table";
  batchId: string;
  items: PendingToolView[];
  warnings: IntakeTableWarning[];
}

/** `PATCH /api/pending-tools/[id]`. At least one key; `discard: true` discards. */
export interface PatchPendingToolBody {
  name?: string;
  brand?: string | null;
  categoryHint?: string | null;
  locationHint?: string | null;
  serialNumber?: string | null;
  duplicateResolution?: DuplicateResolution | null;
  discard?: true;
}

export interface PendingToolResponse {
  item: PendingToolView;
}

/** `POST /api/pending-tools/research`. */
export interface ResearchRequestBody {
  ids: string[];
}

/**
 * What the research route answers once the items have moved.
 *
 * `queued` went to the workflow; `readyAsUnit` were add-unit items that skip
 * research (§5.4 step 8). `runId` is null when nothing needed a run.
 */
export interface ResearchStartedResponse {
  requestId: string;
  runId: string | null;
  queued: string[];
  readyAsUnit: string[];
  /**
   * An image-only redo (amendment "Guided redo"): nothing was queued — the
   * image stage alone is running, as **Find a different image**.
   */
  imageOnly?: true;
}

export type PendingApiErrorCode =
  | "invalid_body"
  | "sign_in_required"
  | "forbidden"
  | "not_found"
  | "not_editable"
  | "invalid_field"
  | "rate_limited"
  | "too_many_items"
  | "daily_limit"
  | "unresolved_duplicate"
  | "not_researchable"
  | "start_failed"
  | "image_retry_running"
  | "failed";

/** Every refusal body from the pending-tools routes. */
export interface PendingApiError {
  code: PendingApiErrorCode;
  /** English fallback only — clients render the code. */
  error: string;
  /** The items the refusal is about, when it is about some of them. */
  ids?: string[];
  /** `daily_limit` only: how many more items this person may research today. */
  remaining?: number;
}
