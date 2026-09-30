"use server";

import { MANUALS_REPROCESS } from "../../../lib/actions/manuals";
import { performAction } from "../../../lib/actions/perform";
import { RESOURCES_ADD, RESOURCES_EDIT, RESOURCES_REMOVE } from "../../../lib/actions/resources";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import type { NewResource, ResourcePatch } from "../../../lib/data/resources";
import type { ResourceCreatePayload, ResourceWritePayload } from "../../../lib/inventory/resource-edits";
import type { InventoryActionResult } from "./action-result";
import type { ToolWriteInput } from "./tool-write-context";

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
 * token, like every other write on this surface — one-line wrappers over
 * `resources.*` and `manuals.reprocess` (`src/lib/actions/`, assistant–GUI
 * parity spec §9 phases 4–5).
 */

/**
 * Add a manual, SOP or link.
 *
 * `filesSubmitted` / `filesAttached` come back and a shortfall raises
 * `files_not_attached` — the file-shaped sibling of the photo warning. The
 * resource is still created — losing the link because its PDF expired would
 * be the worse failure. A link or an uploaded PDF asks the manual archive to
 * keep a copy, after the write landed (manual text spec §3.1).
 */
export async function addResource(
  input: ToolWriteInput & {
    resource: NewResource;
    fileAttachmentIds?: readonly string[];
  }
): Promise<InventoryActionResult<ResourceCreatePayload>> {
  return performAction(RESOURCES_ADD, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}

/** Edit a resource — title, type, link, notes, or whether it is published. */
export async function editResource(
  input: ToolWriteInput & { resourceId: string; patch: ResourcePatch }
): Promise<InventoryActionResult<ResourceWritePayload>> {
  return performAction(RESOURCES_EDIT, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}

/**
 * Re-process a resource's manual (manual text spec §5 "Admin"): extract its
 * PDF again and rebuild its search passages, in the archive workflow. Nothing
 * about the tool changes, so the panel keeps the token it holds
 * (`{ ok: true, revision: expectedRevision }`). A resource of another tool is
 * `not_found`.
 */
export async function reprocessManual(
  input: ToolWriteInput & { resourceId: string }
): Promise<InventoryActionResult> {
  return performAction(MANUALS_REPROCESS, input, await resolveIdentityFromHeaders(), { surface: "gui" });
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
  return performAction(RESOURCES_REMOVE, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}
