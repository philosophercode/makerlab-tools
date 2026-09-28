import "server-only";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { TAXONOMY_PATH, type TaxonomyActionCode } from "../../app/admin/taxonomy/action-result";
import { record } from "../admin/audit-warning";
import {
  createCategoryProposal,
  decideCategoryProposal,
  editCategory,
  findCategory,
  findCategoryProposal,
  mergeCategories,
  setCategoryRetired,
  CATEGORY_DESCRIPTION_MAX,
  CATEGORY_NAME_MAX,
  PROPOSAL_REASON_MAX,
  type ProposalDecision,
} from "../data/category-admin";
import { categories, tools } from "../db/schema";
import { getDb } from "../db/client";
import type { CategoryProposalSource } from "../db/schema/vocabulary";
import { saveToolFields } from "../inventory/tool-edits";
import { requestMirrorPush } from "../mirror/trigger";
import { invalidateCatalog } from "../revalidate";
import {
  INVENTORY_REVALIDATE,
  inventoryOutcome,
  revisionInputFor,
  toolPage,
  toolRef,
  toolRevisionInput,
  type InventoryRefusal,
  type InventoryValue,
  type ToolRevisionInput,
} from "./catalog-write";
import { auditTrail, defineAction, toolShape, type ActionContext, type ActionPreview } from "./define";
import { MAX_BATCH } from "./tool-args";

/**
 * The taxonomy's actions (taxonomy v2 spec §4.6): the GUI's `/admin/taxonomy`
 * controls, the assistant's proposing tools and MCP's, all one path.
 *
 * - `taxonomy.propose_category` — anybody who may edit tools may *propose* a
 *   category (`tools.edit`); the proposal waits in the queue.
 * - `taxonomy.decide_proposal`, `taxonomy.merge`, `taxonomy.edit_category`,
 *   `taxonomy.set_retired` — `taxonomy.manage` (admin and super admin).
 *   Merging moves every tool and retires the source, so it is `destructive`:
 *   one at a time, the name typed, never over MCP, never from a tainted turn.
 * - `taxonomy.recategorize_tool` — `tools.edit`, the editor's own save path
 *   (the tool's revision rides on the input, so an edit between card and
 *   click is `conflict`).
 *
 * Structural changes are audited (`category.created`, `category.merged`,
 * `category.retired`); a rename or a new description is an ordinary edit
 * (§4.11). Every committed change invalidates the catalogue (a tool's
 * category is on its card) and tells the Notion mirror.
 */

const AUDIT_WHERE = "admin/taxonomy";

/** A category the model names: its slug from the list tools, or its id. */
const CATEGORY_REF = z.string().min(1).max(120).describe("The category's slug (e.g. \"hand-saws\"), from list_categories, or its id");

/** Where a proposal came from, by surface: the GUI's form, the chat, an MCP client. */
function sourceFor(ctx: ActionContext): CategoryProposalSource {
  if (ctx.surface === "assistant") return "chat";
  if (ctx.surface === "mcp") return "mcp";
  return "gui";
}

async function categoryLabel(id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const row = await findCategory(id);
  if (!row) return null;
  const parent = row.parentId ? await findCategory(row.parentId) : null;
  const head = parent?.name ?? row.group;
  return head ? `${head} › ${row.name}` : row.name;
}

/** The category a model wrote, as an id (unknown text kept, so `check` answers `not_found`). */
async function categoryIdFor(ref: string | null | undefined): Promise<string | null> {
  if (!ref) return null;
  const row = await findCategory(ref);
  return row?.id ?? ref;
}

async function afterStructuralChange(): Promise<void> {
  invalidateCatalog();
  await requestMirrorPush();
}

// ── taxonomy.propose_category ───────────────────────────────────────

interface ProposeInput {
  name: string;
  parentId?: string | null;
  description?: string | null;
  reason?: string | null;
  toolId?: string | null;
}

export const TAXONOMY_PROPOSE_CATEGORY = defineAction<ProposeInput, { proposalId: string }, TaxonomyActionCode>({
  id: "taxonomy.propose_category",
  toolName: "propose_category",
  description:
    "Propose a new category for the lab's taxonomy (name, parent, what belongs in it and why none of the existing ones fit). It only joins the review queue on /admin/taxonomy — a person with taxonomy rights accepts, merges or rejects it. Proposes; nothing changes until the person confirms it on the card.",
  permission: "tools.edit",
  risk: "catalog",
  input: z.object({
    name: z.string(),
    parentId: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    reason: z.string().nullable().optional(),
    toolId: z.string().nullable().optional(),
  }),
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "category_proposal", id: input.name.trim().toLowerCase().slice(0, 64) || "new" }),
  tool: toolShape(
    z.strictObject({
      name: z.string().min(1).max(CATEGORY_NAME_MAX).describe("The new category's name, e.g. \"Oscillating Tools\""),
      parent: CATEGORY_REF.nullable().describe("The top-level category it belongs under (slug), or null for a new top-level one"),
      description: z.string().max(CATEGORY_DESCRIPTION_MAX).describe("One to three sentences: what belongs in it and what does not"),
      reason: z.string().max(PROPOSAL_REASON_MAX).describe("Why none of the existing categories fits"),
      tool_id: z.string().max(200).nullable().describe("The tool that prompted it, if any (id or slug) — accepting moves it in"),
    }),
    async (args) => {
      const tool = args.tool_id ? await toolRef(args.tool_id) : null;
      return {
        ok: true,
        inputs: [
          {
            name: args.name,
            parentId: await categoryIdFor(args.parent),
            description: args.description,
            reason: args.reason,
            toolId: tool?.id ?? null,
          },
        ],
      };
    }
  ),
  check: async (input) => {
    if (!input.name.trim() || input.name.trim().length > CATEGORY_NAME_MAX) return "invalid_field";
    if (input.parentId) {
      const parent = await findCategory(input.parentId);
      if (!parent) return "not_found";
      if (parent.retiredAt) return "retired_target";
      if (parent.parentId) return "invalid_field";
    }
    return null;
  },
  preview: async (input) => {
    const parent = await categoryLabel(input.parentId);
    const name = input.name.trim();
    return {
      summary: { key: "taxonomy_propose", values: { name } },
      rows: [
        { field: "category", before: null, after: parent ? `${parent} › ${name}` : name },
        ...(input.description ? [{ field: "description", before: null, after: input.description }] : []),
      ],
      subjectName: name,
      link: TAXONOMY_PATH,
    };
  },
  run: async (input, ctx) => {
    const created = await createCategoryProposal(await getDb(), {
      name: input.name,
      parentId: input.parentId ?? null,
      description: input.description ?? null,
      reason: input.reason ?? null,
      source: sourceFor(ctx),
      subjectType: input.toolId ? "tool" : null,
      subjectId: input.toolId ?? null,
      nearestExistingId: input.toolId ? await currentCategoryOf(input.toolId) : null,
      actorUserId: ctx.identity.userId,
    });
    if (!created.ok) return { ok: false, error: created.reason };
    return { ok: true, value: { proposalId: created.id }, committed: true };
  },
  revalidate: [TAXONOMY_PATH],
});

async function currentCategoryOf(toolId: string): Promise<string | null> {
  const db = await getDb();
  const [row] = await db.select({ categoryId: tools.categoryId }).from(tools).where(eq(tools.id, toolId)).limit(1);
  return row?.categoryId ?? null;
}

// ── taxonomy.decide_proposal ────────────────────────────────────────

interface DecideInput {
  proposalId: string;
  decision: ProposalDecision;
  targetCategoryId?: string | null;
  name?: string | null;
  parentId?: string | null;
  description?: string | null;
}

export const TAXONOMY_DECIDE_PROPOSAL = defineAction<DecideInput, object, TaxonomyActionCode, { status: string; categoryId: string | null }>({
  id: "taxonomy.decide_proposal",
  toolName: "decide_category_proposal",
  description:
    "Decide one waiting category proposal from /admin/taxonomy: accept it (creates the category and moves its tool in), merge it into an existing category (the tool goes there instead; for an audit flag, the flagged category is merged), or reject it. Proposes the decision; nothing changes until the person confirms it on the card.",
  permission: "taxonomy.manage",
  risk: "catalog",
  input: z.object({
    proposalId: z.string(),
    decision: z.enum(["accept", "merge", "reject"]),
    targetCategoryId: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    parentId: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
  }),
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "category_proposal", id: input.proposalId }),
  tool: toolShape(
    z.strictObject({
      proposal_id: z.string().min(1).max(64).describe("The proposal's id, from list_category_proposals"),
      decision: z.enum(["accept", "merge", "reject"]).describe("accept, merge (into merge_into) or reject"),
      merge_into: CATEGORY_REF.nullable().describe("For merge: the existing category (slug); null for accept or reject"),
    }),
    async (args) => ({
      ok: true,
      inputs: [{ proposalId: args.proposal_id, decision: args.decision, targetCategoryId: await categoryIdFor(args.merge_into) }],
    })
  ),
  check: async (input) => {
    const proposal = await findCategoryProposal(input.proposalId);
    if (!proposal) return "not_found";
    if (proposal.status !== "pending") return "already_decided";
    if (input.decision === "accept" && proposal.kind !== "new_category") return "invalid_decision";
    if (input.decision === "merge" && !(input.targetCategoryId ?? proposal.nearestExistingId)) return "invalid_decision";
    return null;
  },
  preview: async (input) => {
    const proposal = await findCategoryProposal(input.proposalId);
    if (!proposal) return null;
    const parent = await categoryLabel(proposal.parentId);
    const proposed = parent ? `${parent} › ${proposal.name}` : proposal.name;
    const after =
      input.decision === "accept"
        ? proposed
        : input.decision === "merge"
          ? await categoryLabel(input.targetCategoryId ?? proposal.nearestExistingId)
          : null;
    return {
      summary: { key: `taxonomy_decide_${input.decision}`, values: { name: proposal.name } },
      rows: [{ field: "category", before: proposal.kind === "review_category" ? proposed : null, after }],
      subjectName: proposal.name,
      link: TAXONOMY_PATH,
      version: proposal.status,
    };
  },
  run: async (input, ctx) => {
    const decided = await decideCategoryProposal(await getDb(), { ...input, actorUserId: ctx.identity.userId });
    if (!decided.ok) return { ok: false, error: decided.reason };
    return { ok: true, value: {}, committed: { status: decided.status, categoryId: decided.categoryId } };
  },
  afterCommit: async (input, committed, ctx) => {
    let recorded = true;
    if (committed.status === "accepted" && committed.categoryId) {
      recorded = await record(
        { ...auditTrail(ctx), actorUserId: ctx.identity.userId, action: "category.created", subjectType: "category", subjectId: committed.categoryId, detail: { proposalId: input.proposalId } },
        AUDIT_WHERE
      );
    }
    if (committed.status !== "rejected") await afterStructuralChange();
    return recorded ? undefined : "audit_unavailable";
  },
  revalidate: [TAXONOMY_PATH, ...INVENTORY_REVALIDATE],
});

// ── taxonomy.merge ──────────────────────────────────────────────────

export const TAXONOMY_MERGE = defineAction<{ fromId: string; intoId: string }, { movedTools: number }, TaxonomyActionCode, { movedTools: number }>({
  id: "taxonomy.merge",
  toolName: "merge_categories",
  description:
    "Merge one category into another: every tool in it moves, and it is retired with a note of where they went. Proposes the merge; nothing changes until the person types the category's name on the card and confirms.",
  permission: "taxonomy.manage",
  risk: "destructive",
  input: z.object({ fromId: z.string(), intoId: z.string() }),
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "category", id: input.fromId }),
  tool: toolShape(
    z.strictObject({
      from: CATEGORY_REF.describe("The category to merge away (slug)"),
      into: CATEGORY_REF.describe("The category its tools move to (slug)"),
    }),
    async (args) => ({ ok: true, inputs: [{ fromId: (await categoryIdFor(args.from)) ?? args.from, intoId: (await categoryIdFor(args.into)) ?? args.into }] })
  ),
  check: async (input) => {
    const [from, into] = await Promise.all([findCategory(input.fromId), findCategory(input.intoId)]);
    if (!from || !into) return "not_found";
    if (from.id === into.id) return "invalid_field";
    if (from.retiredAt) return "already_decided";
    if (into.retiredAt) return "retired_target";
    return null;
  },
  preview: async (input) => {
    const from = await findCategory(input.fromId);
    const into = await findCategory(input.intoId);
    if (!from || !into) return null;
    const db = await getDb();
    const moving = await db.select({ id: tools.id }).from(tools).where(eq(tools.categoryId, from.id));
    return {
      summary: { key: "taxonomy_merge", values: { from: from.name, into: into.name, count: moving.length } },
      rows: [{ field: "mergeInto", before: (await categoryLabel(from.id)) ?? from.name, after: (await categoryLabel(into.id)) ?? into.name }],
      subjectName: from.name,
      link: TAXONOMY_PATH,
    };
  },
  run: async (input, ctx) => {
    const merged = await mergeCategories(await getDb(), { ...input, actorUserId: ctx.identity.userId });
    if (!merged.ok) return { ok: false, error: merged.reason };
    return { ok: true, value: { movedTools: merged.movedTools }, committed: { movedTools: merged.movedTools } };
  },
  afterCommit: async (input, committed, ctx) => {
    const recorded = await record(
      {
        ...auditTrail(ctx),
        actorUserId: ctx.identity.userId,
        action: "category.merged",
        subjectType: "category",
        subjectId: input.fromId,
        detail: { into: input.intoId, movedTools: committed.movedTools },
      },
      AUDIT_WHERE
    );
    await afterStructuralChange();
    return recorded ? undefined : "audit_unavailable";
  },
  revalidate: [TAXONOMY_PATH, ...INVENTORY_REVALIDATE],
});

// ── taxonomy.edit_category ──────────────────────────────────────────

interface EditInput {
  categoryId: string;
  name?: string;
  description?: string | null;
}

export const TAXONOMY_EDIT_CATEGORY = defineAction<EditInput, object, TaxonomyActionCode>({
  id: "taxonomy.edit_category",
  toolName: "edit_category",
  description:
    "Rename a category or rewrite its description (what belongs in it and what does not). Its slug never changes. Proposes the edit; nothing changes until the person confirms it on the card.",
  permission: "taxonomy.manage",
  risk: "catalog",
  input: z.object({ categoryId: z.string(), name: z.string().optional(), description: z.string().nullable().optional() }),
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "category", id: input.categoryId }),
  tool: toolShape(
    z.strictObject({
      category: CATEGORY_REF,
      name: z.string().max(CATEGORY_NAME_MAX).nullable().describe("The new name, or null to keep it"),
      description: z.string().max(CATEGORY_DESCRIPTION_MAX).nullable().describe("The new description, or null to keep it"),
    }),
    async (args) => ({
      ok: true,
      inputs: [
        {
          categoryId: (await categoryIdFor(args.category)) ?? args.category,
          ...(args.name ? { name: args.name } : {}),
          ...(args.description !== null ? { description: args.description } : {}),
        },
      ],
    })
  ),
  check: async (input) => ((await findCategory(input.categoryId)) ? null : "not_found"),
  preview: async (input) => {
    const category = await findCategory(input.categoryId);
    if (!category) return null;
    const rows: ActionPreview["rows"] = [];
    if (input.name !== undefined) rows.push({ field: "name", before: category.name, after: input.name });
    if (input.description !== undefined) rows.push({ field: "description", before: category.description, after: input.description });
    return { summary: { key: "taxonomy_edit_category", values: { name: category.name } }, rows, subjectName: category.name, link: TAXONOMY_PATH };
  },
  run: async (input, ctx) => {
    const edited = await editCategory(await getDb(), { id: input.categoryId, name: input.name, description: input.description, actorUserId: ctx.identity.userId });
    if (!edited.ok) return { ok: false, error: edited.reason };
    return { ok: true, value: {}, committed: true };
  },
  afterCommit: async () => {
    await afterStructuralChange();
    return undefined;
  },
  revalidate: [TAXONOMY_PATH],
});

// ── taxonomy.set_retired ────────────────────────────────────────────

export const TAXONOMY_SET_RETIRED = defineAction<{ categoryId: string; retired: boolean }, object, TaxonomyActionCode>({
  id: "taxonomy.set_retired",
  toolName: "retire_category",
  description:
    "Retire an empty category (it leaves every list and research stops offering it) or restore a retired one. A category with tools is merged instead. Proposes the change; nothing changes until the person confirms it on the card.",
  permission: "taxonomy.manage",
  risk: "catalog",
  input: z.object({ categoryId: z.string(), retired: z.boolean() }),
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "category", id: input.categoryId }),
  tool: toolShape(
    z.strictObject({ category: CATEGORY_REF, retired: z.boolean().describe("true to retire, false to restore") }),
    async (args) => ({ ok: true, inputs: [{ categoryId: (await categoryIdFor(args.category)) ?? args.category, retired: args.retired }] })
  ),
  check: async (input) => ((await findCategory(input.categoryId)) ? null : "not_found"),
  preview: async (input) => {
    const category = await findCategory(input.categoryId);
    if (!category) return null;
    return {
      summary: { key: input.retired ? "taxonomy_retire" : "taxonomy_restore", values: { name: category.name } },
      rows: [{ field: "retired", before: category.retiredAt ? "retired" : "active", after: input.retired ? "retired" : "active" }],
      subjectName: category.name,
      link: TAXONOMY_PATH,
    };
  },
  run: async (input, ctx) => {
    const done = await setCategoryRetired(await getDb(), { id: input.categoryId, retired: input.retired, actorUserId: ctx.identity.userId });
    if (!done.ok) return { ok: false, error: done.reason };
    return { ok: true, value: {}, committed: true };
  },
  afterCommit: async (input, _committed, ctx) => {
    const recorded = await record(
      { ...auditTrail(ctx), actorUserId: ctx.identity.userId, action: "category.retired", subjectType: "category", subjectId: input.categoryId, detail: { retired: input.retired } },
      AUDIT_WHERE
    );
    await afterStructuralChange();
    return recorded ? undefined : "audit_unavailable";
  },
  revalidate: [TAXONOMY_PATH],
});

// ── taxonomy.recategorize_tool ──────────────────────────────────────

type RecategorizeInput = ToolRevisionInput & { categoryId: string };

export const TAXONOMY_RECATEGORIZE_TOOL = defineAction<RecategorizeInput, InventoryValue<object>, TaxonomyActionCode | InventoryRefusal>({
  id: "taxonomy.recategorize_tool",
  toolName: "recategorize_tool",
  description:
    "Move tools into another existing category (by slug). Never creates a category — propose one with propose_category. Proposes the move; nothing changes until the person confirms it on the card.",
  permission: "tools.edit",
  risk: "catalog",
  maxBatch: MAX_BATCH,
  input: toolRevisionInput.extend({ categoryId: z.string() }),
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "tool", id: input.toolId }),
  tool: toolShape(
    z.strictObject({
      tool_ids: z.array(z.string().min(1).max(200)).min(1).max(MAX_BATCH).describe("The tools' ids (or slugs), from search_tools or the page's selection"),
      category: CATEGORY_REF,
    }),
    async (args) => {
      const categoryId = (await categoryIdFor(args.category)) ?? args.category;
      const inputs = await Promise.all(args.tool_ids.map(revisionInputFor));
      return { ok: true, inputs: inputs.map((input) => ({ ...input, categoryId })) };
    }
  ),
  check: async (input) => {
    const category = await findCategory(input.categoryId);
    if (!category) return "not_found";
    if (category.retiredAt) return "retired_target";
    return null;
  },
  preview: async (input) => {
    const tool = input.expectedRevision ? await toolRef(input.toolId) : null;
    if (!tool) return null;
    const current = await currentCategoryOf(tool.id);
    return {
      summary: { key: "taxonomy_recategorize_tool", values: { name: tool.name } },
      rows: [{ field: "category", before: await categoryLabel(current), after: await categoryLabel(input.categoryId) }],
      subjectName: tool.name,
      link: toolPage(tool.slug),
    };
  },
  run: async (input, ctx) => {
    const db = await getDb();
    const [category] = await db.select({ id: categories.id }).from(categories).where(eq(categories.id, input.categoryId));
    if (!category) return { ok: false, error: "not_found" };
    return inventoryOutcome(
      await saveToolFields({ toolId: input.toolId, patch: { categoryId: category.id }, expectedRevision: input.expectedRevision, actorUserId: ctx.identity.userId })
    );
  },
  afterCommit: async () => {
    await requestMirrorPush();
    return undefined;
  },
  revalidate: [...INVENTORY_REVALIDATE, TAXONOMY_PATH],
});

export const TAXONOMY_ACTIONS = [
  TAXONOMY_PROPOSE_CATEGORY,
  TAXONOMY_DECIDE_PROPOSAL,
  TAXONOMY_MERGE,
  TAXONOMY_EDIT_CATEGORY,
  TAXONOMY_SET_RETIRED,
  TAXONOMY_RECATEGORIZE_TOOL,
] as const;
