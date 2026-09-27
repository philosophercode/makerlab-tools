"use server";

import {
  attachPhotos as attachPhotosWrite,
  removePhoto as removePhotoWrite,
  reorderPhotos as reorderPhotosWrite,
  type PhotoCountPayload,
  type PhotoOrderPayload,
} from "../../../lib/inventory/photo-edits";
import type { InventoryActionResult } from "./action-result";
import { withToolEdit, type ToolWriteInput } from "./tool-write-context";

/**
 * The Photos section of the tool editor — attach, reorder, remove
 * (spec §5.3(3), §4.7).
 *
 * **Uploading happens before any of this.** The panel posts the file to
 * `POST /api/uploads` with `kind: "tool"` (public, `tools.add`), which returns
 * an `attachments` id owned by nothing; `attachPhotos` claims those ids. With
 * no `BLOB_READ_WRITE_TOKEN` that route answers 503 and the panel says photos
 * cannot be added right now — these actions are unreachable rather than broken,
 * and everything else in the panel still works (Article 4).
 *
 * **Position 0 is the cover** (§4.7), so "make this the cover" and "reorder"
 * are one operation and there is only one of them.
 */

/**
 * Attach uploaded photos, after the ones the tool already has.
 *
 * `photosSubmitted` / `photosAttached` come back and a shortfall raises
 * `photos_not_attached`: a claim only takes *unowned* rows, and the daily cron
 * sweeps uploads after 24 hours. Saying "attached" over either would be the
 * quiet lie Article 4 forbids.
 */
export async function attachPhotos(
  input: ToolWriteInput & { attachmentIds: readonly string[] }
): Promise<InventoryActionResult<PhotoCountPayload>> {
  return withToolEdit(input, (context) => attachPhotosWrite(context, input.attachmentIds));
}

/** Set the order; the first is the cover. Ids from another tool move nothing. */
export async function reorderPhotos(
  input: ToolWriteInput & { orderedIds: readonly string[] }
): Promise<InventoryActionResult<PhotoOrderPayload>> {
  return withToolEdit(input, (context) => reorderPhotosWrite(context, input.orderedIds));
}

/**
 * Remove a photo from the tool.
 *
 * The row is released and the bytes are left to the daily sweep; the photo
 * leaves the page the moment this commits, which is what "remove" means to the
 * person clicking it. Renumbering promotes the next photo to cover.
 */
export async function removePhoto(
  input: ToolWriteInput & { attachmentId: string }
): Promise<InventoryActionResult<PhotoOrderPayload>> {
  return withToolEdit(input, (context) => removePhotoWrite(context, input.attachmentId));
}
