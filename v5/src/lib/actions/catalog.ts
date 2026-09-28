import "server-only";

import { z } from "zod";
import { archiveTool, markReviewed, publishTool, restoreTool, unpublishTool } from "../inventory/tool-state";
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
import { auditTrail, defineAction, toolShape, type ActionPreview } from "./define";
import { MAX_BATCH } from "./tool-args";

/**
 * A tool's state, from the editor panel (assistant–GUI parity spec §4.4
 * #28–30, §9 phase 4): publish, unpublish, archive, restore, and **Looks
 * good**. Moved from `app/admin/inventory/actions.ts`, whose exports are now
 * one-line wrappers.
 *
 * Every one carries the tool's revision. The panel sends the token it read
 * when it opened; a card stores the token read when the proposal was made. A
 * save in between answers `conflict` and writes nothing, on either surface.
 *
 * Publishing, unpublishing, archiving and restoring are audited
 * (`tool.published`, `tool.unpublished`, `tool.archived`) by
 * `lib/inventory/tool-state.ts`, now with the surface and proposal
 * (`auditTrail`); Looks good is an ordinary edit (§4.11).
 */

/** Many tools, one change: "publish these three". Each becomes its own row. */
const TOOL_REFS = z
  .array(z.string().min(1).max(200))
  .min(1)
  .max(MAX_BATCH)
  .describe("The tools' ids (or slugs), from search_tools or the page's selection — several to make the same change to each");

async function inputsFor(refs: readonly string[]): Promise<ToolRevisionInput[]> {
  return Promise.all(refs.map(revisionInputFor));
}

/** The card for a change to one field of a tool's state. */
async function statePreview(
  input: ToolRevisionInput,
  key: string,
  row: (tool: NonNullable<Awaited<ReturnType<typeof toolRef>>>) => ActionPreview["rows"][number]
): Promise<ActionPreview | null> {
  const tool = input.expectedRevision ? await toolRef(input.toolId) : null;
  if (!tool) return null;
  return { summary: { key, values: { name: tool.name } }, rows: [row(tool)], subjectName: tool.name, link: toolPage(tool.slug) };
}

// ── tools.set_published ─────────────────────────────────────────────

/**
 * **Publish** / **Unpublish** (Article 5: a tool is a draft until a person
 * with `tools.publish` says so — here, by the button or by a card's Confirm).
 * One definition for both directions, like `projects.set_published`: they are
 * one decision, and the assistant has one tool for it (§4.9 row 29).
 */
export const TOOLS_SET_PUBLISHED = defineAction<
  ToolRevisionInput & { published: boolean },
  InventoryValue<object>,
  InventoryRefusal
>({
  id: "tools.set_published",
  toolName: "set_tool_published",
  description:
    "Publish tools to the public catalogue, or unpublish them (they stay in inventory as drafts). Proposes the change; nothing changes until the person confirms it on the card.",
  permission: "tools.publish",
  risk: "catalog",
  maxBatch: MAX_BATCH,
  input: toolRevisionInput.extend({ published: z.boolean() }),
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "tool", id: input.toolId }),
  tool: toolShape(
    z.strictObject({
      tool_ids: TOOL_REFS,
      published: z.boolean().describe("true to publish, false to unpublish"),
    }),
    async (args) => ({ ok: true, inputs: (await inputsFor(args.tool_ids)).map((input) => ({ ...input, published: args.published })) })
  ),
  preview: (input) =>
    statePreview(input, input.published ? "tools_publish" : "tools_unpublish", (tool) => ({
      field: "catalogue",
      before: tool.published ? "published" : "unpublished",
      after: input.published ? "published" : "unpublished",
      format: "published",
    })),
  run: async (input, ctx) => {
    const change = { ...writeContext(input, ctx), trail: auditTrail(ctx) };
    return inventoryOutcome(await (input.published ? publishTool(change) : unpublishTool(change)));
  },
  afterCommit: tellMirror,
  revalidate: INVENTORY_REVALIDATE,
});

// ── tools.mark_reviewed ─────────────────────────────────────────────

/**
 * **Looks good** — the inventory review's one-click mark (§5.3(3)).
 * `tools.edit`: saying a record is accurate is the review itself.
 */
export const TOOLS_MARK_REVIEWED = defineAction<ToolRevisionInput, InventoryValue<object>, InventoryRefusal>({
  id: "tools.mark_reviewed",
  toolName: "mark_tool_reviewed",
  description:
    "Mark tools as reviewed (\"Looks good\") — the record was checked and is accurate. Proposes the mark; nothing changes until the person confirms it on the card.",
  permission: "tools.edit",
  risk: "catalog",
  maxBatch: MAX_BATCH,
  input: toolRevisionInput,
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "tool", id: input.toolId }),
  tool: toolShape(z.strictObject({ tool_ids: TOOL_REFS }), async (args) => ({ ok: true, inputs: await inputsFor(args.tool_ids) })),
  preview: (input) =>
    statePreview(input, "tools_mark_reviewed", (tool) => ({
      field: "lastReviewed",
      before: tool.lastReviewedAt ? tool.lastReviewedAt.toISOString().slice(0, 10) : null,
      after: new Date().toISOString().slice(0, 10),
    })),
  run: async (input, ctx) => inventoryOutcome(await markReviewed(writeContext(input, ctx))),
  afterCommit: tellMirror,
  revalidate: INVENTORY_REVALIDATE,
});

// ── tools.archive / tools.restore ───────────────────────────────────

/**
 * **Archive**: the machine is gone, its history is not — never a delete
 * (§5.3 "Deleting"). Destructive for the assistant (§4.9 row 30): the card
 * asks for the tool's name, one at a time, never from a turn that read
 * outside content (§8.4).
 */
export const TOOLS_ARCHIVE = defineAction<ToolRevisionInput, InventoryValue<object>, InventoryRefusal>({
  id: "tools.archive",
  toolName: "archive_tool",
  description:
    "Archive one tool that has left the lab: it disappears from the catalogue and inventory lists, its history stays. Proposes the archive; nothing changes until the person types the tool's name on the card and confirms.",
  permission: "tools.publish",
  risk: "destructive",
  input: toolRevisionInput,
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "tool", id: input.toolId }),
  tool: toolShape(z.strictObject({ tool_id: TOOL_REF }), async (args) => ({ ok: true, inputs: [await revisionInputFor(args.tool_id)] })),
  preview: (input) =>
    statePreview(input, "tools_archive", (tool) => ({
      field: "archived",
      before: tool.archived ? "archived" : "active",
      after: "archived",
      format: "archived",
    })),
  run: async (input, ctx) => inventoryOutcome(await archiveTool({ ...writeContext(input, ctx), trail: auditTrail(ctx) })),
  afterCommit: tellMirror,
  revalidate: INVENTORY_REVALIDATE,
});

/** **Restore** an archived tool. Recorded as `tool.archived` with `archived: false`. */
export const TOOLS_RESTORE = defineAction<ToolRevisionInput, InventoryValue<object>, InventoryRefusal>({
  id: "tools.restore",
  toolName: "restore_tool",
  description:
    "Restore one archived tool to inventory (it comes back as it was, published or not). Proposes the restore; nothing changes until the person confirms it on the card.",
  permission: "tools.publish",
  risk: "catalog",
  input: toolRevisionInput,
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "tool", id: input.toolId }),
  tool: toolShape(z.strictObject({ tool_id: TOOL_REF }), async (args) => ({ ok: true, inputs: [await revisionInputFor(args.tool_id)] })),
  preview: (input) =>
    statePreview(input, "tools_restore", (tool) => ({
      field: "archived",
      before: tool.archived ? "archived" : "active",
      after: "active",
      format: "archived",
    })),
  run: async (input, ctx) => inventoryOutcome(await restoreTool({ ...writeContext(input, ctx), trail: auditTrail(ctx) })),
  afterCommit: tellMirror,
  revalidate: INVENTORY_REVALIDATE,
});
