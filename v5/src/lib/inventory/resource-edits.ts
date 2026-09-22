import "server-only";

import {
  createResource,
  deleteResource,
  updateResource,
  type NewResource,
  type ResourcePatch,
} from "../data/resources";
import type { InventoryWriteResult } from "./result";
import { withTouchedTool, type ToolWriteContext } from "./tool-transaction";

/**
 * The Resources section of the tool editor — manuals, SOPs and links
 * (spec §5.3(3), §4.6).
 *
 * A resource is a URL, an uploaded PDF, or both. **The upload itself is already
 * solved:** the panel posts to `POST /api/uploads` with `kind: "resource"`,
 * which writes the blob and an unowned `attachments` row and returns its id;
 * this write claims that id onto the resource. Nothing here talks to Blob.
 *
 * Each write touches the tool in the same transaction — see
 * `./tool-transaction.ts`.
 */

export interface ResourceWritePayload {
  resourceId: string;
}

/** The same, plus how many of the submitted files actually attached. */
export interface ResourceCreatePayload extends ResourceWritePayload {
  filesSubmitted: number;
  filesAttached: number;
}

/**
 * Add a resource to a tool.
 *
 * `filesSubmitted` / `filesAttached` come back the way `POST /api/projects`
 * reports photos, and for the same reason: a panel left open overnight submits
 * ids the daily cron has already swept, and telling somebody their manual is
 * attached when it is not is the quiet lie Article 4 forbids. The resource
 * itself is still created — losing the link because its PDF expired would be
 * the worse failure.
 */
export async function addResource(
  context: ToolWriteContext,
  input: NewResource,
  fileAttachmentIds: readonly string[] = []
): Promise<InventoryWriteResult<ResourceCreatePayload>> {
  const result = await withTouchedTool(context, async (tx) => {
    const created = await createResource(tx, context.toolId, input, {
      actorUserId: context.actorUserId,
      fileAttachmentIds,
    });
    return created.ok
      ? {
          ok: true,
          resourceId: created.resourceId,
          filesSubmitted: fileAttachmentIds.length,
          filesAttached: created.filesAttached,
        }
      : created;
  });

  // The same *failure* a lost photo raises, and a different code for it: the
  // panel asks the same question — is what I just added actually there? — but
  // it asks it about a manual, and "some photos did not attach" would send
  // somebody to the wrong section looking for a file that was never there.
  // Counts alone are easy to render and easy to ignore, which is why there is
  // a code at all.
  if (!result.ok) return result;
  return result.filesAttached < result.filesSubmitted
    ? { ...result, warning: "files_not_attached" }
    : result;
}

/** Edit one of the tool's resources — title, type, link, notes, published. */
export async function editResource(
  context: ToolWriteContext,
  resourceId: string,
  patch: ResourcePatch
): Promise<InventoryWriteResult<ResourceWritePayload>> {
  return withTouchedTool(context, async (tx) => {
    const written = await updateResource(
      tx,
      { toolId: context.toolId, resourceId },
      patch,
      { actorUserId: context.actorUserId }
    );
    return written.ok ? { ok: true, resourceId: written.resourceId } : written;
  });
}

/**
 * Remove a resource.
 *
 * Genuinely deleted, unlike a tool: a resource is a link or a file, not a
 * record anything refers to. Its files are released to the orphan sweep in the
 * same transaction rather than left owned by a row that no longer exists.
 */
export async function removeResource(
  context: ToolWriteContext,
  resourceId: string
): Promise<InventoryWriteResult<ResourceWritePayload>> {
  return withTouchedTool(context, async (tx) => {
    const deleted = await deleteResource(tx, { toolId: context.toolId, resourceId });
    return deleted.ok ? { ok: true, resourceId: deleted.resourceId } : deleted;
  });
}
