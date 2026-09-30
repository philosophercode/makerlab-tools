"use server";

import { performAction } from "../../../lib/actions/perform";
import {
  TAXONOMY_DECIDE_PROPOSAL,
  TAXONOMY_EDIT_CATEGORY,
  TAXONOMY_MERGE,
  TAXONOMY_PROPOSE_CATEGORY,
  TAXONOMY_RECATEGORIZE_TOOL,
  TAXONOMY_SET_RETIRED,
} from "../../../lib/actions/taxonomy";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import type { RecategorizeToolResult, TaxonomyActionResult } from "./action-result";

/**
 * `/admin/taxonomy`'s server actions (taxonomy v2 spec §5.3) — one-line
 * wrappers over the definitions in `src/lib/actions/taxonomy.ts`, which gate
 * (`taxonomy.manage`, or `tools.edit` to propose or move a tool), write,
 * audit and invalidate. Nothing is decided here.
 */

export async function decideCategoryProposal(input: {
  proposalId: string;
  decision: "accept" | "merge" | "reject";
  targetCategoryId?: string | null;
  name?: string | null;
  parentId?: string | null;
  description?: string | null;
}): Promise<TaxonomyActionResult> {
  return performAction(TAXONOMY_DECIDE_PROPOSAL, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}

export async function proposeCategory(input: {
  name: string;
  parentId?: string | null;
  description?: string | null;
  reason?: string | null;
}): Promise<TaxonomyActionResult> {
  return performAction(TAXONOMY_PROPOSE_CATEGORY, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}

export async function mergeCategories(input: { fromId: string; intoId: string }): Promise<TaxonomyActionResult> {
  return performAction(TAXONOMY_MERGE, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}

export async function editCategory(input: { categoryId: string; name?: string; description?: string | null }): Promise<TaxonomyActionResult> {
  return performAction(TAXONOMY_EDIT_CATEGORY, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}

export async function setCategoryRetired(input: { categoryId: string; retired: boolean }): Promise<TaxonomyActionResult> {
  return performAction(TAXONOMY_SET_RETIRED, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}

export async function recategorizeTool(input: { toolId: string; expectedRevision: string; categoryId: string }): Promise<RecategorizeToolResult> {
  return performAction(TAXONOMY_RECATEGORIZE_TOOL, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}
