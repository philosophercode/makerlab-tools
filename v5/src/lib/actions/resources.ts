import "server-only";

import { z } from "zod";
import { listResourcesForEditor, type EditorResource, type NewResource, type ResourcePatch } from "../data/resources";
import { getDb } from "../db/client";
import {
  addResource as addResourceWrite,
  editResource as editResourceWrite,
  removeResource as removeResourceWrite,
  type ResourceCreatePayload,
  type ResourceWritePayload,
} from "../inventory/resource-edits";
import { requestManualArchive } from "../manuals/trigger";
import {
  INVENTORY_REVALIDATE,
  inventoryOutcome,
  revisionInputFor,
  tellMirror,
  TOOL_REF,
  toolPage,
  toolRef,
  toolRevisionInput,
  writeContext,
  type InventoryRefusal,
  type InventoryValue,
  type ToolRevisionInput,
} from "./catalog-write";
import { defineAction, toolShape, type ActionPreview, type ActionPreviewRow } from "./define";

/**
 * A tool's manuals, SOPs and links, from the editor's Resources section
 * (assistant–GUI parity spec §4.4 #33, §9 phase 4). Moved from
 * `app/admin/inventory/resource-actions.ts`.
 *
 * `tools.edit` and the tool's revision on each, like every editor write. A new
 * link, or an uploaded PDF, asks the manual archive to keep a copy
 * (`requestManualArchive`, which never throws) once the write landed.
 * **Remove** is destructive for the assistant: a resource is genuinely
 * deleted, with its files released.
 *
 * The assistant adds links only — a PDF reaches the app through an upload,
 * which is the panel's (§2: uploading a file is not a sentence).
 */

const resourceFields = {
  title: z.string().optional(),
  type: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  published: z.boolean().optional(),
};

const resourceArgs = {
  type: z.string().max(60).nullable().optional().describe("What kind of document: Manual, SOP, Safety, Link…; null clears it"),
  url: z.string().url().max(2048).nullable().optional().describe("The link, exactly as the person or a read tool gave it"),
  notes: z.string().max(2000).nullable().optional().describe("A note for staff; null clears it"),
  published: z.boolean().optional().describe("Whether visitors and the assistant see it (default true)"),
};

type ResourceArgs = { title?: string } & { [K in keyof typeof resourceArgs]?: z.infer<(typeof resourceArgs)[K]> };

function patchFrom(args: ResourceArgs): ResourcePatch {
  const patch: ResourcePatch = {};
  if (args.title !== undefined) patch.title = args.title;
  if (args.type !== undefined) patch.type = args.type;
  if (args.url !== undefined) patch.url = args.url;
  if (args.notes !== undefined) patch.notes = args.notes;
  if (args.published !== undefined) patch.published = args.published;
  return patch;
}

const RESOURCE_ROWS: { field: string; key: keyof ResourcePatch; format?: ActionPreviewRow["format"] }[] = [
  { field: "resourceTitle", key: "title" },
  { field: "resourceType", key: "type" },
  { field: "url", key: "url" },
  { field: "notes", key: "notes" },
  { field: "catalogue", key: "published", format: "published" },
];

function shown(value: unknown, key: keyof ResourcePatch): string | null {
  if (value === undefined || value === null) return null;
  if (key === "published") return value ? "published" : "unpublished";
  return String(value);
}

function resourceRows(before: EditorResource | null, patch: ResourcePatch): ActionPreviewRow[] {
  return RESOURCE_ROWS.filter((row) => patch[row.key] !== undefined).map((row) => ({
    field: row.field,
    before: before ? shown(before[row.key], row.key) : null,
    after: shown(patch[row.key], row.key),
    ...(row.format ? { format: row.format } : {}),
  }));
}

async function toolAndResource(input: ToolRevisionInput & { resourceId?: string }) {
  if (!input.expectedRevision) return null;
  const tool = await toolRef(input.toolId);
  if (!tool) return null;
  if (input.resourceId === undefined) return { tool, resource: null };
  const resource = (await listResourcesForEditor(await getDb(), tool.id)).find((row) => row.id === input.resourceId) ?? null;
  return resource ? { tool, resource } : null;
}

function resourcePreview(
  found: NonNullable<Awaited<ReturnType<typeof toolAndResource>>>,
  key: string,
  title: string,
  rows: ActionPreviewRow[]
): ActionPreview {
  return { summary: { key, values: { tool: found.tool.name, title } }, rows, subjectName: title, link: toolPage(found.tool.slug) };
}

const RESOURCE_ID = z.string().min(1).max(64).describe("The resource's id, from get_tool_units");

// ── resources.add ───────────────────────────────────────────────────

/**
 * **Add** a manual, SOP or link. The panel may also claim uploaded PDFs
 * (`fileAttachmentIds`); a shortfall is `files_not_attached` on a success —
 * the resource is created either way.
 */
export const RESOURCES_ADD = defineAction<
  ToolRevisionInput & { resource: NewResource; fileAttachmentIds?: readonly string[] },
  InventoryValue<ResourceCreatePayload>,
  InventoryRefusal,
  { resourceId: string }
>({
  id: "resources.add",
  toolName: "add_resource",
  description:
    "Add a resource (a manual, SOP, safety page or other link) to a tool, with a title and a link. Proposes the addition; nothing changes until the person confirms it on the card.",
  permission: "tools.edit",
  risk: "catalog",
  input: toolRevisionInput.extend({
    resource: z.object({ ...resourceFields, title: z.string() }),
    fileAttachmentIds: z.array(z.string()).optional(),
  }),
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "tool", id: input.toolId }),
  tool: toolShape(
    z.strictObject({ tool_id: TOOL_REF, title: z.string().min(1).max(200).describe("The resource's title, as it should read on the tool page"), ...resourceArgs }),
    async (args) => ({
      ok: true,
      inputs: [{ ...(await revisionInputFor(args.tool_id)), resource: { published: true, ...patchFrom(args) } as NewResource }],
    })
  ),
  preview: async (input) => {
    const found = await toolAndResource(input);
    return found ? resourcePreview(found, "resources_add", input.resource.title, resourceRows(null, input.resource)) : null;
  },
  run: async (input, ctx) => {
    const outcome = inventoryOutcome(await addResourceWrite(writeContext(input, ctx), input.resource, input.fileAttachmentIds ?? []));
    return outcome.ok ? { ...outcome, committed: { resourceId: outcome.value.resourceId } } : outcome;
  },
  // A link may be a manual worth keeping a copy of, and an uploaded PDF one
  // worth processing into text (manual text spec §3.1) — after the write, and
  // never able to fail it.
  afterCommit: async (input, committed) => {
    await tellMirror();
    if (input.resource.url || (input.fileAttachmentIds?.length ?? 0) > 0) await requestManualArchive([committed.resourceId]);
    return undefined;
  },
  revalidate: INVENTORY_REVALIDATE,
});

// ── resources.edit ──────────────────────────────────────────────────

/** **Edit** a resource — title, type, link, notes, or whether it is published. */
export const RESOURCES_EDIT = defineAction<
  ToolRevisionInput & { resourceId: string; patch: ResourcePatch },
  InventoryValue<ResourceWritePayload>,
  InventoryRefusal
>({
  id: "resources.edit",
  toolName: "edit_resource",
  description:
    "Change one resource's title, kind, link, notes, or whether visitors see it. Only the fields passed change. Proposes the change; nothing changes until the person confirms it on the card.",
  permission: "tools.edit",
  risk: "catalog",
  input: toolRevisionInput.extend({ resourceId: z.string(), patch: z.object(resourceFields) }),
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "resource", id: input.resourceId }),
  tool: toolShape(
    z.strictObject({ tool_id: TOOL_REF, resource_id: RESOURCE_ID, title: z.string().min(1).max(200).optional().describe("A new title"), ...resourceArgs }),
    async (args) => {
      const patch = patchFrom(args);
      if (Object.keys(patch).length === 0) return { ok: false, error: "nothing_to_change" };
      return { ok: true, inputs: [{ ...(await revisionInputFor(args.tool_id)), resourceId: args.resource_id, patch }] };
    }
  ),
  preview: async (input) => {
    const found = await toolAndResource(input);
    return found?.resource ? resourcePreview(found, "resources_edit", found.resource.title, resourceRows(found.resource, input.patch)) : null;
  },
  run: async (input, ctx) => inventoryOutcome(await editResourceWrite(writeContext(input, ctx), input.resourceId, input.patch)),
  // A new link (or a new type) may mean a manual to copy; the archive skips
  // one it already holds.
  afterCommit: async (input) => {
    await tellMirror();
    if (input.patch.url || input.patch.type !== undefined) await requestManualArchive([input.resourceId]);
    return undefined;
  },
  revalidate: INVENTORY_REVALIDATE,
});

// ── resources.remove ────────────────────────────────────────────────

/** **Remove** — genuinely deleted, unlike a tool; its files are released in the same transaction. */
export const RESOURCES_REMOVE = defineAction<
  ToolRevisionInput & { resourceId: string },
  InventoryValue<ResourceWritePayload>,
  InventoryRefusal
>({
  id: "resources.remove",
  toolName: "remove_resource",
  description:
    "Remove one resource (link or document) from a tool, for good. To hide it instead, use edit_resource with published false. Proposes the removal; nothing changes until the person types the resource's title on the card and confirms.",
  permission: "tools.edit",
  risk: "destructive",
  input: toolRevisionInput.extend({ resourceId: z.string() }),
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "resource", id: input.resourceId }),
  tool: toolShape(z.strictObject({ tool_id: TOOL_REF, resource_id: RESOURCE_ID }), async (args) => ({
    ok: true,
    inputs: [{ ...(await revisionInputFor(args.tool_id)), resourceId: args.resource_id }],
  })),
  preview: async (input) => {
    const found = await toolAndResource(input);
    return found?.resource ? resourcePreview(found, "resources_remove", found.resource.title, []) : null;
  },
  run: async (input, ctx) => inventoryOutcome(await removeResourceWrite(writeContext(input, ctx), input.resourceId)),
  afterCommit: tellMirror,
  revalidate: INVENTORY_REVALIDATE,
});
