"use server";

import { authorizeAdminAction } from "../../../lib/admin/action-gate";
import { listCategories, listLocations } from "../../../lib/data/taxonomy";
import { loadToolEditor } from "../../../lib/data/tool-editor";
import { otherToolNames } from "../../../lib/data/tool-name-clash";
import { getDb } from "../../../lib/db/client";
import type { ToolPatch } from "../../../lib/data/tools";
import { saveToolFields } from "../../../lib/inventory/tool-edits";
import {
  archiveTool,
  markReviewed,
  publishTool,
  restoreTool,
  unpublishTool,
} from "../../../lib/inventory/tool-state";
import { type InventoryActionResult, type LoadToolEditorResult } from "./action-result";
import { withToolEdit, withToolWrite, type ToolWriteInput } from "./tool-write-context";

/**
 * The tool editor's own writes (spec §5.3(3)–(5), §8).
 *
 * **Every one of these checks its own permission**, because a server action is
 * a POST endpoint with a generated name: it is reachable without the panel that
 * offers the control, so the panel is evidence of nothing. `authorizeAdminAction`
 * is the shared preamble — identity, limiter, permission, in that order.
 *
 * **Two permissions, not one.** Editing is `tools.edit`; publishing,
 * unpublishing, archiving and restoring are `tools.publish`. Both are held by
 * `admin` today, so nothing changes behaviourally — but the declaration's own
 * stated future ("SuperMakers may add tools but not publish them") is now a
 * one-line change in `permissions.ts` rather than a rewrite of this file.
 *
 * **A refusal is a value; a conflict is a refusal.** `{ ok: false, error }`
 * reaches the panel as a message it can render, and `conflict` specifically
 * means *nothing was written* — the panel keeps what the person typed and
 * offers a reload (§5.3(4)). A thrown error would reach the browser as a digest
 * and an error boundary, which loses the unsaved edits this phase exists to
 * protect.
 *
 * **And a change that landed minus its audit event is a success with a
 * warning.** That channel lives in `src/lib/admin/audit-warning.ts` and is
 * applied by `src/lib/inventory/`; nothing here answers `{ ok: false }` for a
 * write that is in the database.
 *
 * The child sections — units, resources, photos — are in their own modules
 * beside this one, so no module grows past one job.
 */

/**
 * Open the panel: everything about one tool, plus the token its saves carry.
 *
 * **A reader, and still a POST endpoint**, so it checks `tools.edit` for
 * itself — this read sees drafts, archived tools, unpublished resources and
 * retired units, none of which the catalogue shows anybody.
 *
 * It is also what guarantees the revision is minted **when the panel opens**
 * rather than when the page was rendered or cached. A token read from a page
 * that has been sitting in a tab since this morning would make every save a
 * conflict; one read from a cached HTML page would make the check meaningless.
 */
export async function loadToolForEditor(idOrSlug: string): Promise<LoadToolEditorResult> {
  const gate = await authorizeAdminAction("tools.edit");
  if (!gate.ok) return gate;

  const editor = await loadToolEditor(idOrSlug);
  if (!editor) return { ok: false, error: "not_found" };

  // The two option lists the fields form needs. Read here rather than in
  // `loadToolEditor`, which is about one tool: these belong to the whole lab.
  const [categories, locations, taken] = await Promise.all([
    listCategories(),
    listLocations(),
    getDb().then((db) => otherToolNames(db, editor.tool.id)),
  ]);

  return { ok: true, editor: { ...editor, categories, locations, otherToolNames: taken } };
}

/** Save the editor's fields. `tools.edit`. */
export async function saveTool(
  input: ToolWriteInput & { patch: ToolPatch }
): Promise<InventoryActionResult> {
  return withToolEdit(input, (context) =>
    saveToolFields({ ...context, patch: input.patch })
  );
}

/**
 * **Looks good** — the review's one-click mark (§5.3(3)). `tools.edit`.
 *
 * Deliberately not `tools.publish`: saying a record is accurate is the review
 * itself, and it is the same act as fixing a field.
 */
export async function markToolReviewed(input: ToolWriteInput): Promise<InventoryActionResult> {
  // `withToolEdit`, not `withToolWrite("tools.edit", …)`: naming the permission
  // here as well as there is a second place for it to be wrong, and the two
  // would not disagree loudly — one action quietly gating on the other's.
  return withToolEdit(input, markReviewed);
}

/** Publish a tool: the draft becomes catalogue (Article 5). `tools.publish`. */
export async function publish(input: ToolWriteInput): Promise<InventoryActionResult> {
  return withToolWrite("tools.publish", input, publishTool);
}

/** Unpublish: it stops being catalogue without losing anything. `tools.publish`. */
export async function unpublish(input: ToolWriteInput): Promise<InventoryActionResult> {
  return withToolWrite("tools.publish", input, unpublishTool);
}

/** Archive: the machine is gone, its history is not. Never a delete. */
export async function archive(input: ToolWriteInput): Promise<InventoryActionResult> {
  return withToolWrite("tools.publish", input, archiveTool);
}

/** Restore an archived tool. Recorded as `tool.archived` with `archived: false`. */
export async function restore(input: ToolWriteInput): Promise<InventoryActionResult> {
  return withToolWrite("tools.publish", input, restoreTool);
}
