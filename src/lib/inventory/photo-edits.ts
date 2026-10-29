import "server-only";

import {
  claimAttachments,
  listAttachmentsForOwner,
  releaseAttachments,
  reorderAttachments,
  type ClaimOwner,
} from "../data/attachments";
import type { Db } from "../db/types";
import type { InventoryWriteResult } from "./result";
import { withTouchedTool, type ToolWriteContext } from "./tool-transaction";

/**
 * The Photos section of the tool editor — attach, reorder, remove
 * (spec §5.3(3), §4.7).
 *
 * **Uploading is already solved and is not here.** The panel posts to
 * `POST /api/uploads` with `kind: "tool"`, which writes the blob and an
 * *unowned* `attachments` row and returns its id; these writes claim, order and
 * release those rows. Nothing in this module talks to Blob, which is also why
 * every one of them works with `BLOB_READ_WRITE_TOKEN` unset.
 *
 * **Position 0 is the cover** (§4.7), so "make this the cover" and "reorder"
 * are the same operation and there is only one of them.
 */

/** What comes back beside the new revision. */
export interface PhotoCountPayload {
  /** How many ids the panel sent. */
  photosSubmitted: number;
  /** How many of them are now this tool's. */
  photosAttached: number;
}

export interface PhotoOrderPayload {
  /** The ids now owned by this tool, cover first. */
  order: string[];
}

/**
 * Attach uploaded photos to a tool, after the ones it already has.
 *
 * **Appended, not prepended.** `claimAttachments` numbers from zero, which on a
 * tool that already has photos would make the newest upload the cover — a
 * surprise nobody asked for. The existing order is read, the new ids are added
 * to the end, and the whole list is renumbered.
 *
 * `photosSubmitted` and `photosAttached` come back the way `POST /api/projects`
 * reports them, and a shortfall raises `photos_not_attached`: a panel left open
 * overnight submits ids the daily cron has already swept, and a claim only ever
 * takes *unowned* rows, so somebody else's photo id silently claims nothing.
 * Saying "attached" over either would be the quiet lie Article 4 forbids.
 */
export async function attachPhotos(
  context: ToolWriteContext,
  attachmentIds: readonly string[]
): Promise<InventoryWriteResult<PhotoCountPayload>> {
  const result = await withTouchedTool(context, async (tx) => {
    const owner = toolOwner(context.toolId);

    const before = await listAttachmentsForOwner(tx, owner);
    const beforeIds = before.map((row) => row.id);

    const photosAttached = await claimAttachments(tx, attachmentIds, owner);

    // Which ids actually stuck is not something `claimAttachments` reports, and
    // guessing from the caller's list would put a swept id into the order.
    const after = await listAttachmentsForOwner(tx, owner);
    const added = after.map((row) => row.id).filter((id) => !beforeIds.includes(id));

    await reorderAttachments(tx, owner, [...beforeIds, ...added]);

    return { ok: true, photosSubmitted: attachmentIds.length, photosAttached };
  });

  if (!result.ok) return result;
  return result.photosAttached < result.photosSubmitted
    ? { ...result, warning: "photos_not_attached" }
    : result;
}

/**
 * Set the order of a tool's photos; the first is the cover.
 *
 * Ids that are not this tool's are ignored rather than refused — a panel racing
 * a removal should still be able to order what is left.
 */
export async function reorderPhotos(
  context: ToolWriteContext,
  orderedIds: readonly string[]
): Promise<InventoryWriteResult<PhotoOrderPayload>> {
  return withTouchedTool(context, async (tx) => {
    const owner = toolOwner(context.toolId);
    await reorderAttachments(tx, owner, orderedIds);
    return { ok: true, order: await currentOrder(tx, owner) };
  });
}

/**
 * Remove a photo from a tool.
 *
 * The row is released, not deleted, and the bytes are left to the daily cron's
 * existing sweep — see `releaseAttachments` for why deleting a blob from inside
 * a request is the worse of the two orderings. The photo leaves the page the
 * moment this commits, which is what "remove" means to the person clicking it.
 *
 * Renumbering afterwards is what promotes the next photo to cover when the
 * cover is the one removed.
 */
export async function removePhoto(
  context: ToolWriteContext,
  attachmentId: string
): Promise<InventoryWriteResult<PhotoOrderPayload>> {
  // The generic is named because the body's early refusal widens `ok` past
  // what inference can narrow on its own.
  return withTouchedTool<PhotoOrderPayload>(context, async (tx) => {
    const owner = toolOwner(context.toolId);

    const released = await releaseAttachments(tx, owner, [attachmentId]);
    // Not this tool's photo, or already gone. Either way there is nothing to
    // remove, and the tool's revision must not move for it.
    if (released === 0) return { ok: false, reason: "not_found" as const };

    const remaining = await listAttachmentsForOwner(tx, owner);
    await reorderAttachments(
      tx,
      owner,
      remaining.map((row) => row.id)
    );

    return { ok: true, order: remaining.map((row) => row.id) };
  });
}

/** What {@link setCoverPhoto} answers beside the new revision. */
export interface CoverPayload {
  /** The ids now owned by this tool, cover first. */
  order: string[];
  /** The cover it replaced, when `replace` released it. */
  replacedId: string | null;
}

/**
 * Make a freshly stored photo the tool's **cover** (photo options spec
 * 2026-10-29 §4): claim it, put it at position 0, and — with `replace` —
 * release the photo that was the cover, in the same transaction, for the daily
 * sweep (as {@link removePhoto} does). The other photos keep their order.
 *
 * A row nobody can claim (already owned, or gone) writes nothing and answers
 * `not_found`, so the tool's revision does not move for a cover that is not
 * there.
 */
export async function setCoverPhoto(
  context: ToolWriteContext,
  attachmentId: string,
  opts: { replace: boolean }
): Promise<InventoryWriteResult<CoverPayload>> {
  return withTouchedTool<CoverPayload>(context, async (tx) => {
    const owner = toolOwner(context.toolId);
    const before = (await listAttachmentsForOwner(tx, owner)).map((row) => row.id);
    const claimed = await claimAttachments(tx, [attachmentId], owner);
    if (claimed === 0) return { ok: false, reason: "not_found" as const };

    const oldCover = before[0] ?? null;
    let replacedId: string | null = null;
    if (opts.replace && oldCover) {
      replacedId = (await releaseAttachments(tx, owner, [oldCover])) > 0 ? oldCover : null;
    }
    const rest = before.filter((id) => id !== replacedId);
    await reorderAttachments(tx, owner, [attachmentId, ...rest]);
    return { ok: true, order: await currentOrder(tx, owner), replacedId };
  });
}

function toolOwner(toolId: string): ClaimOwner {
  return { ownerType: "tool", ownerId: toolId };
}

async function currentOrder(db: Db, owner: ClaimOwner): Promise<string[]> {
  const rows = await listAttachmentsForOwner(db, owner);
  return rows.map((row) => row.id);
}
