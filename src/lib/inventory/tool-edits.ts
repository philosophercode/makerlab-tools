import "server-only";

import type { Revision } from "../data/revision";
import { updateTool, type ToolPatch } from "../data/tools";
import { getDb } from "../db/client";
import type { Db } from "../db/types";
import { invalidateCatalog } from "../revalidate";
import type { InventoryWriteResult } from "./result";

/**
 * Saving the tool editor's own fields (spec §5.3(4)).
 *
 * One statement, so there is nothing to make atomic — what this adds to
 * `data/tools.ts` is the cache invalidation, which cannot live down there
 * (`src/lib/data/` is loaded by `scripts/` under plain Node). The child
 * sections have their own modules beside this one; a save that also edits units
 * or photos is the action composing them, not this function growing.
 *
 * No audit event: an edit to a description is an ordinary edit, and §4.11 is
 * explicit that those are deliberately not logged. Publishing it is not, and
 * that is in `./tool-state.ts`.
 */
export interface SaveToolFieldsInput {
  toolId: string;
  patch: ToolPatch;
  /** The token the panel received when it opened. */
  expectedRevision: Revision;
  actorUserId?: string | null;
  /** A handle to use instead of {@link getDb} — tests pass an isolated one. */
  db?: Db;
}

/**
 * Write the editor's fields, or refuse.
 *
 * `conflict` means somebody else changed this tool while the panel was open and
 * **nothing was written** — the panel keeps the unsaved edits and offers a
 * reload. It is never a silent overwrite and never a partial one.
 */
export async function saveToolFields(
  input: SaveToolFieldsInput
): Promise<InventoryWriteResult> {
  const db = input.db ?? (await getDb());

  const written = await updateTool(input.toolId, input.patch, input.expectedRevision, {
    db,
    actorUserId: input.actorUserId,
  });
  if (!written.ok) return { ok: false, error: written.reason };

  invalidateCatalog();
  return { ok: true, revision: written.revision };
}
