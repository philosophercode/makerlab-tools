import type { AdminActionWarning, AdminGateError } from "../../../lib/admin/action-result";

/**
 * What `/admin/taxonomy`'s server actions answer, and where the page lives
 * (taxonomy v2 spec §5.3). Directive-free, like every admin result module: the
 * island renders these codes without importing the endpoints.
 */

export const TAXONOMY_PATH = "/admin/taxonomy";

/**
 * Why a taxonomy change did not land. Each has an `admin.errors.<code>` message.
 *
 * - `already_decided` — the proposal was decided (or the category merged) by somebody else first.
 * - `has_children` — a top-level category with live children cannot be merged or retired.
 * - `not_empty` — retiring needs an empty category; merge says where the tools go.
 * - `retired_target` — the chosen category (or parent) is retired.
 * - `invalid_decision` — accept on an audit flag, or merge with no target.
 * - `conflict` — the tool changed since the card or the row was read.
 */
export type TaxonomyActionCode =
  | "not_found"
  | "invalid_field"
  | "duplicate_name"
  | "already_decided"
  | "has_children"
  | "not_empty"
  | "retired_target"
  | "invalid_decision"
  | "conflict";

export type TaxonomyActionResult =
  | { ok: true; warning?: AdminActionWarning }
  | { ok: false; error: AdminGateError | TaxonomyActionCode };

export type DecideCategoryProposalAction = (input: {
  proposalId: string;
  decision: "accept" | "merge" | "reject";
  targetCategoryId?: string | null;
  name?: string | null;
  parentId?: string | null;
  description?: string | null;
}) => Promise<TaxonomyActionResult>;

export type ProposeCategoryAction = (input: {
  name: string;
  parentId?: string | null;
  description?: string | null;
  reason?: string | null;
}) => Promise<TaxonomyActionResult>;

/** Moving a tool goes through the editor's save path, so it can answer the editor's codes too (`not_editable`…). */
export type RecategorizeToolResult = { ok: true; warning?: string } | { ok: false; error: string };

export type RecategorizeToolAction = (input: { toolId: string; expectedRevision: string; categoryId: string }) => Promise<RecategorizeToolResult>;

export type MergeCategoriesAction = (input: { fromId: string; intoId: string }) => Promise<TaxonomyActionResult>;

export type EditCategoryAction = (input: { categoryId: string; name?: string; description?: string | null }) => Promise<TaxonomyActionResult>;

export type SetCategoryRetiredAction = (input: { categoryId: string; retired: boolean }) => Promise<TaxonomyActionResult>;

/** Everything the page hands its island. */
export interface TaxonomyActions {
  decide: DecideCategoryProposalAction;
  propose: ProposeCategoryAction;
  merge: MergeCategoriesAction;
  edit: EditCategoryAction;
  setRetired: SetCategoryRetiredAction;
  recategorize: RecategorizeToolAction;
}
