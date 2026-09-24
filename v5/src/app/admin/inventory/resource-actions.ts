"use server";

import type { NewResource, ResourcePatch } from "../../../lib/data/resources";
import {
  addResource as addResourceWrite,
  editResource as editResourceWrite,
  removeResource as removeResourceWrite,
  type ResourceCreatePayload,
  type ResourceWritePayload,
} from "../../../lib/inventory/resource-edits";
import { requestManualArchive } from "../../../lib/manuals/trigger";
import type { InventoryActionResult } from "./action-result";
import { withToolEdit, type ToolWriteInput } from "./tool-write-context";

/**
 * The Resources section of the tool editor — manuals, SOPs and links
 * (spec §5.3(3), §4.6).
 *
 * **The upload is not here.** A PDF reaches the app through
 * `POST /api/uploads` with `kind: "resource"`, which writes the blob and an
 * *unowned* `attachments` row and hands back its id; `addResource` claims that
 * id onto the new resource. Nothing in this module talks to Blob, which is why
 * every action here works with `BLOB_READ_WRITE_TOKEN` unset — the panel simply
 * cannot offer the file half.
 *
 * Each action gates itself on `tools.edit` and carries the panel's revision
 * token, like every other write on this surface.
 */

/**
 * Add a manual, SOP or link.
 *
 * `filesSubmitted` / `filesAttached` come back and a shortfall raises
 * `files_not_attached` — the file-shaped sibling of the photo warning, because
 * the code is a message key and "some photos did not attach" is the wrong
 * sentence about a manual. A claim only takes *unowned* rows and the daily cron
 * sweeps uploads after 24 hours, so a panel left open overnight submits ids
 * nobody can claim any more. The resource is still created — losing the link
 * because its PDF expired would be the worse failure.
 */
export async function addResource(
  input: ToolWriteInput & {
    resource: NewResource;
    fileAttachmentIds?: readonly string[];
  }
): Promise<InventoryActionResult<ResourceCreatePayload>> {
  const result = await withToolEdit(input, (context) =>
    addResourceWrite(context, input.resource, input.fileAttachmentIds ?? [])
  );
  // A link may be a manual worth keeping a copy of, and an uploaded PDF is one
  // worth processing into text: the same run archives the link, then reads
  // every PDF the resource holds (manual text spec §3.1). Only after the write
  // landed, and never able to fail it (`requestManualArchive` never throws).
  const uploaded = (input.fileAttachmentIds?.length ?? 0) > 0;
  if (result.ok && (input.resource.url || uploaded)) await requestManualArchive([result.resourceId]);
  return result;
}

/** Edit a resource — title, type, link, notes, or whether it is published. */
export async function editResource(
  input: ToolWriteInput & { resourceId: string; patch: ResourcePatch }
): Promise<InventoryActionResult<ResourceWritePayload>> {
  const result = await withToolEdit(input, (context) =>
    editResourceWrite(context, input.resourceId, input.patch)
  );
  // A new link (or a new type) may mean a manual to copy; the archive skips
  // one it already holds, so an unchanged link costs a query and no download.
  if (result.ok && (input.patch.url || input.patch.type !== undefined)) {
    await requestManualArchive([result.resourceId]);
  }
  return result;
}

/**
 * Remove a resource.
 *
 * Genuinely deleted, unlike a tool: a resource is a link or a file, not a
 * record anything refers to. Its files are released in the same transaction.
 */
export async function removeResource(
  input: ToolWriteInput & { resourceId: string }
): Promise<InventoryActionResult<ResourceWritePayload>> {
  return withToolEdit(input, (context) => removeResourceWrite(context, input.resourceId));
}
