import type {
  InventoryActionResult,
  LoadToolEditorResult,
} from "../../app/admin/inventory/action-result";
import type { NewResource, ResourcePatch } from "../../lib/data/resources";
import type { ToolPatch } from "../../lib/data/tools";
import type { NewUnit, UnitPatch } from "../../lib/data/units";
import type { PhotoCountPayload, PhotoOrderPayload } from "../../lib/inventory/photo-edits";
import type {
  ResourceCreatePayload,
  ResourceWritePayload,
} from "../../lib/inventory/resource-edits";
import type { UnitWritePayload } from "../../lib/inventory/unit-edits";

/**
 * Every server action the tool editor can call, as one prop.
 *
 * **The panel never imports the actions.** A client component that imported
 * `app/admin/inventory/actions.ts` would drag `next/headers`, the rate limiter
 * and `server-only` into its graph, which makes it impossible to mount in a
 * component test and couples a control to the page it happens to sit on. The
 * server page hands them down, exactly as `UsersTable` hands `RoleSelect` its
 * `setUserRole` — and the panel is offered from two places (`/admin/inventory`
 * and a tool's own page), which is the other half of the reason.
 *
 * A directive-free module, because both ends import it: a `"use server"` module
 * may export only async functions, and a `"use client"` module's exports reach
 * a server component as client references rather than the values they look
 * like.
 *
 * **Bundled rather than passed one by one** because they travel together: the
 * panel needs all of them or none, and a component test substitutes the whole
 * object with `vi.fn()`s.
 */

/** What every write is told: which tool, and the token the panel holds. */
export interface ToolWriteArgs {
  toolId: string;
  expectedRevision: string;
}

export interface ToolEditorActions {
  /** Opens the panel, and mints the revision every write below carries. */
  load: (idOrSlug: string) => Promise<LoadToolEditorResult>;

  save: (input: ToolWriteArgs & { patch: ToolPatch }) => Promise<InventoryActionResult>;
  markReviewed: (input: ToolWriteArgs) => Promise<InventoryActionResult>;

  publish: (input: ToolWriteArgs) => Promise<InventoryActionResult>;
  unpublish: (input: ToolWriteArgs) => Promise<InventoryActionResult>;
  archive: (input: ToolWriteArgs) => Promise<InventoryActionResult>;
  restore: (input: ToolWriteArgs) => Promise<InventoryActionResult>;

  addUnit: (
    input: ToolWriteArgs & { unit: NewUnit }
  ) => Promise<InventoryActionResult<UnitWritePayload>>;
  editUnit: (
    input: ToolWriteArgs & { unitId: string; patch: UnitPatch }
  ) => Promise<InventoryActionResult<UnitWritePayload>>;
  retireUnit: (
    input: ToolWriteArgs & { unitId: string }
  ) => Promise<InventoryActionResult<UnitWritePayload>>;
  deleteUnit: (
    input: ToolWriteArgs & { unitId: string }
  ) => Promise<InventoryActionResult<UnitWritePayload>>;

  addResource: (
    input: ToolWriteArgs & { resource: NewResource; fileAttachmentIds?: readonly string[] }
  ) => Promise<InventoryActionResult<ResourceCreatePayload>>;
  editResource: (
    input: ToolWriteArgs & { resourceId: string; patch: ResourcePatch }
  ) => Promise<InventoryActionResult<ResourceWritePayload>>;
  removeResource: (
    input: ToolWriteArgs & { resourceId: string }
  ) => Promise<InventoryActionResult<ResourceWritePayload>>;
  /** Re-process a resource's manual PDF (manual text spec §5); the revision is unchanged. */
  reprocessManual: (input: ToolWriteArgs & { resourceId: string }) => Promise<InventoryActionResult>;

  attachPhotos: (
    input: ToolWriteArgs & { attachmentIds: readonly string[] }
  ) => Promise<InventoryActionResult<PhotoCountPayload>>;
  reorderPhotos: (
    input: ToolWriteArgs & { orderedIds: readonly string[] }
  ) => Promise<InventoryActionResult<PhotoOrderPayload>>;
  removePhoto: (
    input: ToolWriteArgs & { attachmentId: string }
  ) => Promise<InventoryActionResult<PhotoOrderPayload>>;
}
