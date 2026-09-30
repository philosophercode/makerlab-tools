import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import { ADMIN_INTAKE_PATH, intakeItemPath, type IntakeWriteError } from "../../app/admin/intake/action-result";
import { can } from "../auth/permissions";
import {
  discardPendingTool,
  EDITABLE_PENDING_STATUSES,
  getPendingTool,
  listPendingTools,
  updatePendingTool,
  type ApprovalFields,
  type PendingTool,
  type PendingToolPatch,
} from "../data/pending-tools";
import { listCategories, listLocations } from "../data/taxonomy";
import { listToolNames } from "../data/tool-name-clash";
import { getDb } from "../db/client";
import { isOneOf, type DuplicateResolution } from "../db/schema/vocabulary";
import { canActOnPendingTool, hasUnresolvedDuplicate } from "../intake/access";
import { initialDraft, initialImageChoice, toFields } from "../intake/approval-draft";
import { addUnitAndRecord, approveAndRecord } from "../intake/approve";
import { requestImageRetry } from "../intake/image-retry";
import { REVIEWER_NOTE_MAX_CHARS } from "../intake/limits";
import { researchStarted, startResearch } from "../intake/research-start";
import { parseReviewerNote } from "../intake/reviewer-note";
import type { PendingApiErrorCode } from "../intake/types";
import { allowanceLeft } from "./allowance";
import { auditTrail, defineAction, toolShape, type ActionContext, type ActionPreviewRow } from "./define";
import { addUnitInput, approveInput, differentImageInput, discardInput, identityInput } from "./intake-input";
import { MAX_BATCH, recordIds } from "./tool-args";

/**
 * The review queue (spec §5.4 steps 10–12, Article 5; assistant–GUI parity
 * spec §4.2 #12–19, §9 phase 5): approve, approve as draft, add as a unit,
 * discard, rename, find a different image — moved from
 * `app/admin/intake/actions.ts`, whose exports are now one-line wrappers —
 * plus the intake table's edit and **Research selected**, whose routes share
 * their writes with these definitions.
 *
 * - **Approve** publishes, so it needs `tools.publish` as well as
 *   `tools.approve` (`check`, on every surface: a card cannot offer what the
 *   page would refuse). **Approve as draft**, **Add unit**, **Discard** and the
 *   name/brand **Save** need `tools.approve`.
 * - The assistant's **approve these** builds, for each item, the very
 *   approval the page would send had the reviewer pressed Approve without
 *   editing a field (`lib/intake/approval-draft.ts`). An item graded low needs
 *   the reviewer's "I've checked this" note, which only the page takes: the
 *   card refuses it, and says why.
 * - **Research** and **Find a different image** spend the research allowance
 *   (§11 answer 3): a card with the person's click, never over MCP, the
 *   allowance checked at the click exactly as for the button.
 *
 * Refusals are values rendered from `admin.errors.<code>`; a thrown error is
 * `failed` (performAction). Every success refreshes the queue and the item's
 * own page.
 */

type IntakeRefusal = IntakeWriteError | "invalid_field" | "not_permitted";

const revalidateItem = (input: { id: string }) => [ADMIN_INTAKE_PATH, intakeItemPath(input.id)];

function signedIn(ctx: ActionContext): { userId: string } | null {
  return ctx.identity.userId ? { userId: ctx.identity.userId } : null;
}

function itemLabel(item: Pick<PendingTool, "name" | "brand">): string {
  return item.brand ? `${item.name} (${item.brand})` : item.name;
}

const PENDING_IDS = recordIds("pending items");
const PENDING_ID = z.string().min(1).max(64).describe("The pending item's id, from list_intake_queue or the page's selection");

// ── pending.approve ─────────────────────────────────────────────────

type ApproveInput = z.infer<typeof approveInput>;

/** The approval the page would send for `item` untouched: research's proposal, the preselected image. */
async function defaultApproval(item: PendingTool): Promise<ApprovalFields | null> {
  const research = item.research;
  if (!research) return null;
  const [categories, locations, names] = await Promise.all([listCategories(), listLocations(), getDb().then(listToolNames)]);
  const imported = item.importId ? { links: item.links } : null;
  const draft = initialDraft(item, research, categories, locations, imported, names.map((row) => row.name));
  // The page's preselection: research's image first, an uploaded photo only when research found none.
  const image = initialImageChoice(research.images, item.photos);
  return toFields(draft, research, image, imported !== null);
}

/** Why a card for this item could only fail, or null. The approval re-checks each under its lock. */
function approvalRefusal(item: PendingTool | null): string | null {
  if (!item) return "not_found";
  if (item.status !== "researched" || item.duplicateResolution === "add_unit" || !item.research) return "not_editable";
  if (hasUnresolvedDuplicate(item)) return "unresolved_duplicate";
  // The "I've checked this" note is the reviewer's own words on the page (§5.4 step 12).
  if (item.research.confidence.level === "low") return "low_confidence";
  return null;
}

export const PENDING_APPROVE = defineAction<
  ApproveInput,
  { toolId: string; slug: string; published: boolean; imageAttached?: boolean; warning?: "audit_unavailable" | "image_not_attached" },
  IntakeRefusal
>({
  id: "pending.approve",
  toolName: "approve_pending_items",
  description:
    "Approve researched pending items into the catalogue exactly as research proposed them (the review page's defaults) — published, or as drafts to finish in the editor. Proposes the approval; nothing changes until the person confirms it on the card.",
  permission: "tools.approve",
  risk: "catalog",
  maxBatch: MAX_BATCH,
  input: approveInput,
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "pending_tool", id: input.id }),
  // Checked on every surface: publishing is the extra permission (Article 5).
  check: async (input, ctx) => (input.publish && !can(ctx.identity, "tools.publish") ? "not_permitted" : null),
  proposeCheck: async (input) => approvalRefusal(await getPendingTool(input.id)),
  tool: toolShape(
    z.strictObject({
      pending_ids: PENDING_IDS,
      publish: z.boolean().describe("true to publish to the catalogue (needs the publish permission), false to approve as drafts"),
    }),
    async (args) => {
      const inputs: ApproveInput[] = [];
      for (const id of args.pending_ids) {
        const item = await getPendingTool(id);
        const fields = item && !approvalRefusal(item) ? await defaultApproval(item) : null;
        // An item that cannot be approved still becomes an input, so its row is
        // refused by `proposeCheck` with its own reason rather than vanishing.
        inputs.push({ id, publish: args.publish, overrideNote: null, fields: fields ?? placeholderFields(item?.name ?? "") });
      }
      return { ok: true, inputs };
    }
  ),
  preview: async (input) => {
    const item = await getPendingTool(input.id);
    if (!item) return null;
    const rows: ActionPreviewRow[] = [
      { field: "toolName", before: null, after: input.fields.name },
      ...(input.fields.categoryProposal || input.fields.newCategory
        ? [{ field: "categoryProposal", before: null, after: (input.fields.categoryProposal ?? input.fields.newCategory)!.name }]
        : []),
      { field: "catalogue", before: null, after: input.publish ? "published" : "unpublished", format: "published" },
    ];
    return {
      summary: { key: input.publish ? "pending_approve" : "pending_approve_draft", values: { name: itemLabel(item) } },
      rows,
      subjectName: item.name,
      link: intakeItemPath(item.id),
      version: approvalVersion(item),
    };
  },
  run: async (input, ctx) => {
    const approver = signedIn(ctx);
    if (!approver) return { ok: false, error: "not_signed_in" };
    const result = await approveAndRecord(
      { ...approver, trail: auditTrail(ctx) },
      { id: input.id, publish: input.publish, fields: input.fields as ApprovalFields, overrideNote: input.overrideNote ?? null }
    );
    if (!result.ok) return { ok: false, error: result.error };
    const { toolId, slug, published, imageAttached, warning } = result;
    return {
      ok: true,
      value: { toolId, slug, published, ...(imageAttached !== undefined ? { imageAttached } : {}), ...(warning ? { warning } : {}) },
      committed: true,
    };
  },
  revalidate: revalidateItem,
});

/**
 * What the card's approval was built from: the item's name and brand, its
 * duplicate decision and its research (which run, and what it found). Every
 * row but the category is new (`before: null`), so without this a rename or a
 * fresh research between card and click would approve the stale fields; with
 * it, the click answers `conflict` (staleness.ts).
 */
function approvalVersion(item: PendingTool): string {
  // The photos too: the preselected image can be one of them.
  const photos = item.photos.map((photo) => photo.attachmentId);
  const basis = JSON.stringify([item.name, item.brand, item.duplicateResolution, item.researchRequestId, item.research, photos]);
  return createHash("sha256").update(basis).digest("base64url");
}

/** A shape that parses, for an item whose row will be refused anyway. */
function placeholderFields(name: string): ApprovalFields {
  return {
    name: name.trim() || "—",
    description: null,
    categoryId: null,
    locationId: null,
    materials: [],
    ppeRequired: [],
    tags: [],
    trainingRequired: true,
    useRestrictions: null,
    serialNumber: null,
  };
}

// ── pending.add_unit ────────────────────────────────────────────────

export const PENDING_ADD_UNIT = defineAction<
  z.infer<typeof addUnitInput>,
  { toolId: string; slug: string; published: boolean; imageAttached?: boolean; warning?: "audit_unavailable" | "image_not_attached" },
  IntakeRefusal
>({
  id: "pending.add_unit",
  toolName: "add_pending_as_unit",
  description:
    "Add a pending item that matched a catalogue tool as another unit of that tool (the item's duplicate decision must be \"add as a unit\"), optionally with its serial number. Proposes the addition; nothing changes until the person confirms it on the card.",
  permission: "tools.approve",
  risk: "catalog",
  input: addUnitInput,
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "pending_tool", id: input.id }),
  proposeCheck: async (input) => {
    const item = await getPendingTool(input.id);
    if (!item) return "not_found";
    return item.status === "researched" && item.duplicateResolution === "add_unit" ? null : "not_editable";
  },
  tool: toolShape(
    z.strictObject({ pending_id: PENDING_ID, serial_number: z.string().max(200).nullable().optional().describe("The machine's serial number, if the person gave one") }),
    (args) => ({ ok: true, inputs: [{ id: args.pending_id, serialNumber: args.serial_number ?? null }] })
  ),
  preview: async (input) => {
    const item = await getPendingTool(input.id);
    if (!item) return null;
    const tool = item.duplicateOf?.kind === "tool" ? item.duplicateOf.name : "—";
    return {
      summary: { key: "pending_add_unit", values: { name: itemLabel(item), tool } },
      rows: input.serialNumber ? [{ field: "serialNumber", before: null, after: input.serialNumber }] : [],
      subjectName: item.name,
      link: intakeItemPath(item.id),
    };
  },
  run: async (input, ctx) => {
    const approver = signedIn(ctx);
    if (!approver) return { ok: false, error: "not_signed_in" };
    const result = await addUnitAndRecord({ ...approver, trail: auditTrail(ctx) }, { id: input.id, serialNumber: input.serialNumber });
    if (!result.ok) return { ok: false, error: result.error };
    const { toolId, slug, published, imageAttached, warning } = result;
    return {
      ok: true,
      value: { toolId, slug, published, ...(imageAttached !== undefined ? { imageAttached } : {}), ...(warning ? { warning } : {}) },
      committed: true,
    };
  },
  revalidate: revalidateItem,
});

// ── pending.discard ─────────────────────────────────────────────────

/**
 * **Discard** — the item leaves the queue and its photos are released for the
 * nightly sweep. Not audited (§4.11). Destructive for the assistant: the card
 * asks for the item's name, one at a time.
 */
export const PENDING_DISCARD = defineAction<z.infer<typeof discardInput>, object, IntakeRefusal>({
  id: "pending.discard",
  toolName: "discard_pending_item",
  description:
    "Discard one pending item from the intake queue (its photos are released). Proposes the discard; nothing changes until the person types the item's name on the card and confirms.",
  permission: "tools.approve",
  risk: "destructive",
  input: discardInput,
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "pending_tool", id: input.id }),
  proposeCheck: async (input) => {
    const item = await getPendingTool(input.id);
    if (!item) return "not_found";
    return isOneOf(EDITABLE_PENDING_STATUSES, item.status) ? null : "not_editable";
  },
  tool: toolShape(z.strictObject({ pending_id: PENDING_ID }), (args) => ({ ok: true, inputs: [{ id: args.pending_id }] })),
  preview: async (input) => {
    const item = await getPendingTool(input.id);
    if (!item) return null;
    return { summary: { key: "pending_discard", values: { name: itemLabel(item) } }, rows: [], subjectName: item.name, link: intakeItemPath(item.id) };
  },
  run: async (input) => {
    const discarded = await discardPendingTool(input.id);
    return discarded.ok ? { ok: true, value: {}, committed: true } : { ok: false, error: discarded.reason };
  },
  revalidate: revalidateItem,
});

// ── pending.save_identity ───────────────────────────────────────────

/**
 * The name/brand **Save** on the preliminary page. Goes through
 * `updatePendingTool`, which re-runs the duplicate check when either changes.
 */
export const PENDING_SAVE_IDENTITY = defineAction<z.infer<typeof identityInput>, object, IntakeRefusal>({
  id: "pending.save_identity",
  toolName: "rename_pending_item",
  description:
    "Correct a pending item's name and brand (the duplicate check runs again). Proposes the change; nothing changes until the person confirms it on the card.",
  permission: "tools.approve",
  risk: "catalog",
  input: identityInput,
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "pending_tool", id: input.id }),
  tool: toolShape(
    z.strictObject({
      pending_id: PENDING_ID,
      name: z.string().min(1).max(200).describe("The corrected name"),
      brand: z.string().max(200).nullable().optional().describe("The brand; null or empty for none"),
    }),
    async (args) => {
      // An unsent brand keeps the one it has: the page always sends both.
      const item = args.brand === undefined ? await getPendingTool(args.pending_id) : null;
      return { ok: true, inputs: [{ id: args.pending_id, name: args.name, brand: args.brand === undefined ? (item?.brand ?? null) : args.brand }] };
    }
  ),
  preview: async (input) => {
    const item = await getPendingTool(input.id);
    if (!item) return null;
    return {
      summary: { key: "pending_save_identity", values: { name: itemLabel(item) } },
      rows: [
        { field: "name", before: item.name, after: input.name },
        { field: "brand", before: item.brand, after: input.brand },
      ],
      subjectName: item.name,
      link: intakeItemPath(item.id),
    };
  },
  run: async (input) => {
    const updated = await updatePendingTool(input.id, { name: input.name, brand: input.brand });
    return updated.ok ? { ok: true, value: {}, committed: true } : { ok: false, error: updated.reason };
  },
  revalidate: revalidateItem,
});

// ── pending.different_image ─────────────────────────────────────────

/**
 * **Find a different image** — the image stage alone, again, with the
 * reviewer's optional note. Costs one against the caller's daily research
 * allowance (`daily_limit` past it), refuses while a run is already going
 * (`image_retry_running`), `start_failed` when the workflow would not start.
 */
export const PENDING_DIFFERENT_IMAGE = defineAction<z.infer<typeof differentImageInput>, object, IntakeRefusal>({
  id: "pending.different_image",
  toolName: "find_different_image",
  description:
    "Search again for a pending item's product image, optionally with a one-line note for the search (\"a front-facing photo of the whole printer\"). Costs one research item from today's allowance. Proposes the search; nothing starts until the person confirms it on the card.",
  permission: "tools.approve",
  risk: "spend",
  input: differentImageInput,
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "pending_tool", id: input.id }),
  tool: toolShape(
    z.strictObject({
      pending_id: PENDING_ID,
      note: z.string().max(REVIEWER_NOTE_MAX_CHARS).optional().describe("One line for the image search, if the person gave one"),
    }),
    (args) => ({ ok: true, inputs: [{ id: args.pending_id, note: args.note ?? null }] })
  ),
  preview: async (input, ctx) => {
    const item = await getPendingTool(input.id);
    if (!item) return null;
    return {
      summary: { key: "pending_different_image", values: { name: itemLabel(item), left: await allowanceLeft(ctx) } },
      rows: input.note ? [{ field: "researchNote", before: null, after: input.note }] : [],
      subjectName: item.name,
      link: intakeItemPath(item.id),
    };
  },
  run: async (input, ctx) => {
    const by = signedIn(ctx);
    if (!by) return { ok: false, error: "not_signed_in" };
    const note = parseReviewerNote(input.note);
    if (note === "too_long" || note === "invalid") return { ok: false, error: "invalid_field" };
    const result = await requestImageRetry(by, { id: input.id, note });
    return result.ok ? { ok: true, value: {}, committed: true } : { ok: false, error: result.error };
  },
  revalidate: revalidateItem,
});

// ── pending.research ────────────────────────────────────────────────

type ResearchRefusal = Exclude<PendingApiErrorCode, "sign_in_required" | "rate_limited" | "failed">;

/**
 * **Research selected (N)** (spec §5.4 step 6): the one start
 * `POST /api/pending-tools/research` runs too (`lib/intake/research-start.ts`)
 * — the same checks in the same order, the allowance decided with the
 * queueing, add-unit items moved on free. One card for the batch, as one press
 * of the button is one request.
 */
export const PENDING_RESEARCH = defineAction<
  { ids: string[]; note?: string | null },
  { queued: string[]; readyAsUnit: string[] },
  ResearchRefusal
>({
  id: "pending.research",
  toolName: "research_pending_items",
  description:
    "Start research on pending items (identified, or failed and to be retried): each costs one item from today's research allowance; items marked \"add as a unit\" cost nothing. Proposes the start; nothing is researched until the person confirms it on the card.",
  permission: "tools.add",
  risk: "spend",
  input: z.strictObject({ ids: z.array(z.string()).min(1).max(MAX_BATCH), note: z.string().max(4000).nullable().optional() }),
  invalidInput: "invalid_body",
  subject: (input) => ({ type: "pending_tool", id: input.ids[0] ?? "" }),
  tool: toolShape(
    z.strictObject({
      pending_ids: PENDING_IDS,
      note: z
        .string()
        .max(REVIEWER_NOTE_MAX_CHARS)
        .optional()
        .describe("One line for research, one item only, reviewers only — only if the person gave one"),
    }),
    (args) => ({ ok: true, inputs: [{ ids: [...new Set(args.pending_ids)], ...(args.note ? { note: args.note } : {}) }] })
  ),
  preview: async (input, ctx) => {
    const items = (await listPendingTools({ ids: input.ids, limit: null })).filter((item) => canActOnPendingTool(ctx.identity, item));
    if (items.length === 0) return null;
    const names = items.map((item) => item.name).join(", ");
    return {
      summary: { key: "pending_research", values: { count: items.length, left: await allowanceLeft(ctx) } },
      rows: [
        { field: "items", before: null, after: names },
        ...(input.note ? [{ field: "researchNote", before: null, after: input.note }] : []),
      ],
      subjectName: names,
      link: ADMIN_INTAKE_PATH,
    };
  },
  run: async (input, ctx) => {
    const userId = ctx.identity.userId;
    if (!userId) return { ok: false, error: "not_signed_in" };
    const answer = await startResearch({ ...ctx.identity, userId }, { ids: input.ids, note: input.note ?? null });
    if (researchStarted(answer)) return { ok: true, value: { queued: answer.body.queued, readyAsUnit: answer.body.readyAsUnit }, committed: true };
    const { code, remaining } = answer.body;
    // The route's own gate codes cannot come from a start; anything else is itself.
    const error = code === "sign_in_required" ? "not_signed_in" : code === "rate_limited" ? "rate_limited" : code;
    return { ok: false, error, ...(remaining !== undefined ? { remaining } : {}) };
  },
  revalidate: [ADMIN_INTAKE_PATH],
});

// ── pending.edit ────────────────────────────────────────────────────

type EditPatch = Pick<PendingToolPatch, "name" | "brand" | "categoryHint" | "locationHint" | "serialNumber" | "duplicateResolution">;

/**
 * The duplicate decisions this action sets. `updatePendingTool` treats
 * "discard" as a discard, and a discard here would skip everything
 * `pending.discard` asks (one at a time, the typed name, refused in a tainted
 * turn). The intake table's PATCH keeps its own discard: that is the person's
 * own click.
 */
const EDIT_RESOLUTIONS = ["new_tool", "add_unit"] as const satisfies readonly DuplicateResolution[];

/**
 * The intake table's edit (`PATCH /api/pending-tools/[id]`, spec §5.4 step 5):
 * name, brand, hints, serial, the duplicate decision — through
 * `updatePendingTool`, which re-runs the duplicate check on a new name. The
 * item's creator, or anybody with `tools.approve` (`canActOnPendingTool`).
 */
export const PENDING_EDIT = defineAction<{ id: string; patch: EditPatch }, object, "not_found" | "not_editable" | "invalid_field" | "not_permitted">({
  id: "pending.edit",
  toolName: "edit_pending_items",
  description:
    "Edit pending items before research or approval: name, brand, category or location hint, serial number, or the duplicate decision (new_tool or add_unit; to discard, use discard_pending_item). Several items take the same hints or decision; a name or serial goes with one item. Proposes the change; nothing changes until the person confirms it on the card.",
  permission: "tools.add",
  risk: "catalog",
  maxBatch: MAX_BATCH,
  input: z.object({
    id: z.string(),
    patch: z.strictObject({
      name: z.string().trim().min(1).max(200).optional(),
      brand: z.string().trim().max(200).nullable().optional(),
      categoryHint: z.string().trim().max(200).nullable().optional(),
      locationHint: z.string().trim().max(200).nullable().optional(),
      serialNumber: z.string().trim().max(200).nullable().optional(),
      // Never "discard": that is `pending.discard`, destructive, typed name (§8.4).
      duplicateResolution: z.enum(EDIT_RESOLUTIONS).nullable().optional(),
    }),
  }),
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "pending_tool", id: input.id }),
  check: async (input, ctx) => {
    const item = await getPendingTool(input.id);
    if (!item) return "not_found";
    return canActOnPendingTool(ctx.identity, item) ? null : "not_permitted";
  },
  tool: toolShape(
    z.strictObject({
      pending_ids: PENDING_IDS,
      name: z.string().min(1).max(200).optional().describe("A new name (one item only)"),
      brand: z.string().max(200).nullable().optional(),
      category_hint: z.string().max(200).nullable().optional(),
      location_hint: z.string().max(200).nullable().optional(),
      serial_number: z.string().max(200).nullable().optional().describe("One item only"),
      duplicate_resolution: z
        .enum(EDIT_RESOLUTIONS)
        .optional()
        .describe("For an item that matched a tool or another item. To discard an item, use discard_pending_item instead"),
    }),
    (args) => {
      const patch: EditPatch = {};
      if (args.name !== undefined) patch.name = args.name;
      if (args.brand !== undefined) patch.brand = args.brand;
      if (args.category_hint !== undefined) patch.categoryHint = args.category_hint;
      if (args.location_hint !== undefined) patch.locationHint = args.location_hint;
      if (args.serial_number !== undefined) patch.serialNumber = args.serial_number;
      if (args.duplicate_resolution !== undefined) patch.duplicateResolution = args.duplicate_resolution;
      if (Object.keys(patch).length === 0) return { ok: false, error: "nothing_to_change" };
      // One name or serial for several machines is a mistake, not a batch.
      if ((patch.name !== undefined || patch.serialNumber !== undefined) && args.pending_ids.length > 1) return { ok: false, error: "invalid_field" };
      return { ok: true, inputs: args.pending_ids.map((id) => ({ id, patch })) };
    }
  ),
  preview: async (input) => {
    const item = await getPendingTool(input.id);
    if (!item) return null;
    const rows: ActionPreviewRow[] = [];
    const add = (field: string, key: keyof EditPatch, before: string | null) => {
      if (input.patch[key] !== undefined) rows.push({ field, before, after: (input.patch[key] as string | null) ?? null });
    };
    add("name", "name", item.name);
    add("brand", "brand", item.brand);
    add("categoryHint", "categoryHint", item.categoryHint);
    add("locationHint", "locationHint", item.locationHint);
    add("serialNumber", "serialNumber", item.serialNumber);
    add("duplicateResolution", "duplicateResolution", item.duplicateResolution);
    return { summary: { key: "pending_edit", values: { name: itemLabel(item) } }, rows, subjectName: item.name, link: ADMIN_INTAKE_PATH };
  },
  run: async (input) => {
    const updated = await updatePendingTool(input.id, input.patch);
    return updated.ok ? { ok: true, value: {}, committed: true } : { ok: false, error: updated.reason };
  },
  revalidate: revalidateItem,
});

