import type { AdminGateError } from "../../../lib/admin/action-result";
import type { CategoryOption, LocationOption } from "../../../lib/data/taxonomy";
import type { ToolEditorData } from "../../../lib/data/tool-editor";
import type { Revision } from "../../../lib/data/revision";
import type {
  InventoryWriteError,
  InventoryWriteWarning,
} from "../../../lib/inventory/result";

/**
 * What the tool editor's server actions answer, and where they live.
 *
 * Its own module with no directive, for the reason
 * `app/admin/users/action-result.ts` is one: a `"use server"` module may export
 * **only async functions**, because every export becomes a callable endpoint.
 * A path constant and a result type cannot live there — and the panel, which is
 * a client island, must be able to render these codes without importing the
 * endpoints to get at their shape.
 */

/** The page these actions belong to, and the path they invalidate. */
export const INVENTORY_PATH = "/admin/inventory";

/**
 * Why an action did nothing. Every code has an `admin.errors.<code>` message.
 *
 * Two halves, and they come from two places on purpose:
 *
 * - {@link AdminGateError} — not signed in, not permitted, over the ceiling, or
 *   "it did not land". Shared with every admin surface, so a refusal reads the
 *   same wherever it happens.
 * - {@link InventoryWriteError} — `conflict`, `not_found`, `invalid_field`,
 *   `duplicate_serial`, `unit_has_history`. The write layer's own vocabulary,
 *   passed straight through rather than re-spelled here: this boundary
 *   translates nothing, so a code cannot drift between the two modules.
 *
 * **`conflict` is the one that is not an apology.** It means somebody else
 * changed this tool while the panel was open and *nothing was written*, so the
 * panel keeps the unsaved edits and offers a reload (§5.3(4)).
 */
export type InventoryActionError = AdminGateError | InventoryWriteError;

/** A change that landed with less than the full guarantee behind it. */
export type InventoryActionWarning = InventoryWriteWarning;

/**
 * The shape every write on this surface answers with.
 *
 * **A success always carries the new revision**, because the panel stays open:
 * the token it handed in is spent, and without the next one its following save
 * would report a conflict against itself.
 */
export type InventoryActionResult<T = unknown> =
  | ({ ok: true; revision: Revision; warning?: InventoryActionWarning } & T)
  | { ok: false; error: InventoryActionError };

/** Everything the panel needs to render itself, once it is allowed to. */
export interface ToolEditorPayload extends ToolEditorData {
  /** The two option lists the fields form selects from (§4.3). */
  categories: CategoryOption[];
  locations: LocationOption[];
  /**
   * Every other tool's display name, so the form can say a name is taken
   * before saving (display names amendment 2026-09-25). The save checks again.
   */
  otherToolNames?: string[];
}

/** What opening (or reloading) the panel answers. */
export type LoadToolEditorResult =
  | { ok: true; editor: ToolEditorPayload }
  | { ok: false; error: InventoryActionError };
