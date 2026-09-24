"use server";

import type { NewResource, ResourcePatch } from "../../../lib/data/resources";
import {
  addResource as addResourceWrite,
  editResource as editResourceWrite,
  removeResource as removeResourceWrite,
  type ResourceCreatePayload,
  type ResourceWritePayload,
} from "../../../lib/inventory/resource-edits";
import { and, eq } from "drizzle-orm";
import { authorizeAdminAction } from "../../../lib/admin/action-gate";
import { markResourceManualsStale } from "../../../lib/data/manual-chunks";
import { isUuid } from "../../../lib/data/uuid";
import { getDb } from "../../../lib/db/client";
import { resources } from "../../../lib/db/schema";
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
 * Re-process a resource's manual (manual text spec §5 "Admin"): extract its
 * PDF again and rebuild its search passages, in the archive workflow.
 *
 * Nothing about the tool changes, so the revision is not touched and the panel
 * keeps the token it holds (`{ ok: true, revision: expectedRevision }`). The
 * documents are *marked* stale, not deleted: the stored text and passages keep
 * serving until the run replaces them. Gated on `tools.edit` like every other
 * resource action; a resource of another tool is `not_found`.
 */
export async function reprocessManual(
  input: ToolWriteInput & { resourceId: string }
): Promise<InventoryActionResult> {
  const gate = await authorizeAdminAction("tools.edit");
  if (!gate.ok) return gate;
  if (!isUuid(input.resourceId) || !isUuid(input.toolId)) return { ok: false, error: "not_found" };
  const db = await getDb();
  const [row] = await db
    .select({ id: resources.id })
    .from(resources)
    .where(and(eq(resources.id, input.resourceId), eq(resources.toolId, input.toolId)));
  if (!row) return { ok: false, error: "not_found" };
  await markResourceManualsStale(db, input.resourceId);
  // Never throws: a start that fails leaves the documents marked, and the next
  // cron run or the backfill picks them up.
  await requestManualArchive([input.resourceId]);
  return { ok: true, revision: input.expectedRevision };
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
