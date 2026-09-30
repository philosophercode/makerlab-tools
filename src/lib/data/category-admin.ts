import { and, asc, count, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { categories, categoryProposals, tools } from "../db/schema/index.ts";
import type { CategoryProposalKind, CategoryProposalSource, CategoryProposalStatus } from "../db/schema/vocabulary.ts";
import type { Db } from "../db/types.ts";
import { categorySlug } from "../taxonomy/slug.ts";
import { isUniqueViolation } from "./pg-errors.ts";
import { revisionOf } from "./revision.ts";
import { isUuid } from "./uuid.ts";

/**
 * The taxonomy's writes and the reads `/admin/taxonomy` needs (taxonomy v2
 * spec §4, §5.3). **Nothing here creates a category except accepting a
 * proposal** ({@link decideCategoryProposal}) — research, refresh, the
 * assistant, MCP and the audit all only *propose* ({@link createCategoryProposal}).
 *
 * Every write takes its handle, answers a refusal as a value and writes in
 * one transaction; the action layer (`lib/actions/taxonomy.ts`) gates, audits
 * and invalidates around them.
 *
 * Relative imports with `.ts` extensions, no `"server-only"`: `scripts/`
 * (`taxonomy:audit`) loads this under plain Node.
 */

export const CATEGORY_NAME_MAX = 60;
export const CATEGORY_DESCRIPTION_MAX = 600;
export const PROPOSAL_REASON_MAX = 600;

export type TaxonomyWriteError =
  | "not_found"
  | "invalid_field"
  | "duplicate_name"
  | "already_decided"
  | "has_children"
  | "not_empty"
  | "retired_target"
  | "invalid_decision";

export type TaxonomyResult<T extends object = object> = ({ ok: true } & T) | { ok: false; reason: TaxonomyWriteError };

export interface TaxonomyDbOptions {
  db?: Db;
}

// ── Reads ───────────────────────────────────────────────────────────

export interface AdminCategory {
  id: string;
  slug: string;
  name: string;
  /** The pre-v2 free-text group, shown on old rows until they are retired. */
  group: string | null;
  description: string | null;
  parentId: string | null;
  sortOrder: number;
  galleryHidden: boolean;
  retiredAt: Date | null;
  mergedIntoId: string | null;
  /** Tools in this category, archived ones not counted. */
  toolCount: number;
}

export interface AdminCategoryProposal {
  id: string;
  kind: CategoryProposalKind;
  name: string;
  parentId: string | null;
  description: string | null;
  reason: string | null;
  source: CategoryProposalSource;
  subjectType: string | null;
  subjectId: string | null;
  /** The subject's name when it is a tool or a category, for the queue's line. */
  subjectName: string | null;
  flag: string | null;
  nearestExistingId: string | null;
  status: CategoryProposalStatus;
  resultingCategoryId: string | null;
  createdAt: Date;
  decidedAt: Date | null;
}

/** Every category, retired ones included, with its live tool count — the page's tree. */
export async function listAdminCategories(options: TaxonomyDbOptions = {}): Promise<AdminCategory[]> {
  const db = options.db ?? (await getDb());
  const counts = db
    .select({ categoryId: tools.categoryId, n: count().as("n") })
    .from(tools)
    .where(isNull(tools.archivedAt))
    .groupBy(tools.categoryId)
    .as("tool_counts");
  const rows = await db
    .select({
      id: categories.id,
      slug: categories.slug,
      name: categories.name,
      group: categories.group,
      description: categories.description,
      parentId: categories.parentId,
      sortOrder: categories.sortOrder,
      galleryHidden: categories.galleryHidden,
      retiredAt: categories.retiredAt,
      mergedIntoId: categories.mergedIntoId,
      toolCount: sql<number>`coalesce(${counts.n}, 0)::int`,
    })
    .from(categories)
    .leftJoin(counts, eq(counts.categoryId, categories.id))
    .orderBy(asc(categories.sortOrder), asc(categories.name));
  return rows.map((row) => ({ ...row, toolCount: Number(row.toolCount) }));
}

/** Pending proposals first (oldest first — they have waited longest), then the latest decided ones. */
export async function listCategoryProposals(
  options: TaxonomyDbOptions & { decidedLimit?: number } = {}
): Promise<AdminCategoryProposal[]> {
  const db = options.db ?? (await getDb());
  const columns = {
    id: categoryProposals.id,
    kind: categoryProposals.kind,
    name: categoryProposals.name,
    parentId: categoryProposals.parentId,
    description: categoryProposals.description,
    reason: categoryProposals.reason,
    source: categoryProposals.source,
    subjectType: categoryProposals.subjectType,
    subjectId: categoryProposals.subjectId,
    flag: categoryProposals.flag,
    nearestExistingId: categoryProposals.nearestExistingId,
    status: categoryProposals.status,
    resultingCategoryId: categoryProposals.resultingCategoryId,
    createdAt: categoryProposals.createdAt,
    decidedAt: categoryProposals.decidedAt,
  };
  const pending = await db
    .select(columns)
    .from(categoryProposals)
    .where(eq(categoryProposals.status, "pending"))
    .orderBy(asc(categoryProposals.createdAt));
  const decided = await db
    .select(columns)
    .from(categoryProposals)
    .where(ne(categoryProposals.status, "pending"))
    .orderBy(desc(categoryProposals.decidedAt))
    .limit(options.decidedLimit ?? 20);
  const rows = [...pending, ...decided];
  const names = await subjectNames(db, rows);
  return rows.map((row) => ({
    ...row,
    kind: row.kind as CategoryProposalKind,
    source: row.source as CategoryProposalSource,
    status: row.status as CategoryProposalStatus,
    subjectName: row.subjectId ? (names.get(`${row.subjectType}:${row.subjectId}`) ?? null) : null,
  }));
}

async function subjectNames(db: Db, rows: { subjectType: string | null; subjectId: string | null }[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const toolIds = rows.filter((row) => row.subjectType === "tool" && row.subjectId && isUuid(row.subjectId)).map((row) => row.subjectId!);
  const categoryIds = rows.filter((row) => row.subjectType === "category" && row.subjectId && isUuid(row.subjectId)).map((row) => row.subjectId!);
  if (toolIds.length) {
    for (const row of await db.select({ id: tools.id, name: tools.name }).from(tools).where(inArray(tools.id, toolIds))) out.set(`tool:${row.id}`, row.name);
  }
  if (categoryIds.length) {
    for (const row of await db.select({ id: categories.id, name: categories.name }).from(categories).where(inArray(categories.id, categoryIds))) {
      out.set(`category:${row.id}`, row.name);
    }
  }
  return out;
}

/** Every live tool with its category and revision — what the page's "move to" controls hand back. */
export async function listToolsForTaxonomy(options: TaxonomyDbOptions = {}) {
  const db = options.db ?? (await getDb());
  return db
    .select({ id: tools.id, slug: tools.slug, name: tools.name, categoryId: tools.categoryId, revision: revisionOf(tools.updatedAt) })
    .from(tools)
    .where(isNull(tools.archivedAt))
    .orderBy(asc(tools.name));
}

/** How many proposals wait — the admin tile's number. */
export async function countPendingCategoryProposals(options: TaxonomyDbOptions = {}): Promise<number> {
  const db = options.db ?? (await getDb());
  const [row] = await db.select({ n: count() }).from(categoryProposals).where(eq(categoryProposals.status, "pending"));
  return row?.n ?? 0;
}

/** One category by id or slug, retired ones included. */
export async function findCategory(ref: string, options: TaxonomyDbOptions = {}) {
  const db = options.db ?? (await getDb());
  const value = ref.trim();
  if (!value) return null;
  const [row] = await db
    .select()
    .from(categories)
    .where(isUuid(value) ? eq(categories.id, value) : eq(categories.slug, value.toLowerCase()))
    .limit(1);
  return row ?? null;
}

/** One proposal, with the columns a decision reads. */
export async function findCategoryProposal(id: string, options: TaxonomyDbOptions = {}) {
  if (!isUuid(id)) return null;
  const db = options.db ?? (await getDb());
  const [row] = await db.select().from(categoryProposals).where(eq(categoryProposals.id, id)).limit(1);
  return row ?? null;
}

// ── Matching ────────────────────────────────────────────────────────

/**
 * An existing, live category for a name somebody (an MCP client, a form)
 * wrote — never a new one (taxonomy v2 spec §4.5): the slug, exactly; else the
 * one live category with exactly that name (any case) whose heading — parent
 * name or pre-v2 group — is the given group, or is anything when no group was
 * given and only one has the name. `topLevel` restricts to top-level ones.
 */
export async function matchExistingCategory(
  db: Db,
  input: { slug: string | null; name: string; group: string | null; topLevel?: boolean }
): Promise<string | null> {
  const slug = input.slug?.trim().toLowerCase();
  if (slug) {
    const [row] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.slug, slug), isNull(categories.retiredAt)))
      .limit(1);
    if (row) return row.id;
  }
  const name = input.name.trim().toLowerCase();
  if (!name) return null;
  const rows = await db
    .select({ id: categories.id, parentId: categories.parentId, group: categories.group })
    .from(categories)
    .where(and(eq(sql`lower(${categories.name})`, name), isNull(categories.retiredAt), input.topLevel ? isNull(categories.parentId) : undefined));
  if (rows.length === 0) return null;
  const group = input.group?.trim().toLowerCase() || null;
  if (!group) return rows.length === 1 ? rows[0].id : null;
  const parentIds = rows.map((row) => row.parentId).filter((id): id is string => Boolean(id));
  const parents = parentIds.length
    ? new Map((await db.select({ id: categories.id, name: categories.name }).from(categories).where(inArray(categories.id, parentIds))).map((row) => [row.id, row.name.toLowerCase()]))
    : new Map<string, string>();
  const matching = rows.filter((row) => (row.parentId ? parents.get(row.parentId) : row.group?.toLowerCase()) === group);
  return matching.length === 1 ? matching[0].id : null;
}

// ── Proposing ───────────────────────────────────────────────────────

export interface NewCategoryProposal {
  kind?: CategoryProposalKind;
  name: string;
  parentId?: string | null;
  description?: string | null;
  reason?: string | null;
  source: CategoryProposalSource;
  subjectType?: "tool" | "pending_tool" | "category" | null;
  subjectId?: string | null;
  flag?: string | null;
  nearestExistingId?: string | null;
  actorUserId?: string | null;
}

function clean(text: string | null | undefined, max: number): string | null {
  const value = (text ?? "").replace(/\s+/g, " ").trim();
  return value ? value.slice(0, max) : null;
}

/**
 * Record a proposal, or answer the one already waiting for the same thing: a
 * pending `new_category` of the same name (any case) under the same parent, or
 * a pending audit flag on the same subject. So research proposing "Oscillating
 * Tools" for three items is one row, and a second `taxonomy:audit` run writes
 * nothing new.
 */
export async function createCategoryProposal(
  db: Db,
  input: NewCategoryProposal
): Promise<TaxonomyResult<{ id: string; created: boolean }>> {
  const kind = input.kind ?? "new_category";
  const name = clean(input.name, CATEGORY_NAME_MAX);
  if (!name) return { ok: false, reason: "invalid_field" };
  const parentId = input.parentId ?? null;
  if (parentId !== null && !isUuid(parentId)) return { ok: false, reason: "invalid_field" };
  const nearest = input.nearestExistingId && isUuid(input.nearestExistingId) ? input.nearestExistingId : null;

  const [existing] = await db
    .select({ id: categoryProposals.id })
    .from(categoryProposals)
    .where(
      and(
        eq(categoryProposals.status, "pending"),
        eq(categoryProposals.kind, kind),
        kind === "review_category"
          ? and(eq(categoryProposals.flag, input.flag ?? ""), eq(categoryProposals.subjectId, input.subjectId ?? ""))
          : and(
              eq(sql`lower(${categoryProposals.name})`, name.toLowerCase()),
              parentId ? eq(categoryProposals.parentId, parentId) : isNull(categoryProposals.parentId)
            )
      )
    )
    .limit(1);
  if (existing) return { ok: true, id: existing.id, created: false };

  const [row] = await db
    .insert(categoryProposals)
    .values({
      kind,
      name,
      parentId,
      description: clean(input.description, CATEGORY_DESCRIPTION_MAX),
      reason: clean(input.reason, PROPOSAL_REASON_MAX),
      source: input.source,
      subjectType: input.subjectType ?? null,
      subjectId: input.subjectId ?? null,
      flag: input.flag ?? null,
      nearestExistingId: nearest,
      createdBy: input.actorUserId ?? null,
    })
    .returning({ id: categoryProposals.id });
  return { ok: true, id: row.id, created: true };
}

// ── Deciding ────────────────────────────────────────────────────────

export type ProposalDecision = "accept" | "merge" | "reject";

export interface DecideProposalInput {
  proposalId: string;
  decision: ProposalDecision;
  /** For `merge`: the existing category the tool goes to (or the flagged category merges into). */
  targetCategoryId?: string | null;
  /** For `accept`: the reviewer's edits to the proposed name, parent and description. */
  name?: string | null;
  parentId?: string | null;
  description?: string | null;
  actorUserId?: string | null;
}

export interface DecideProposalValue {
  status: CategoryProposalStatus;
  /** The category created (accept) or chosen (merge). */
  categoryId: string | null;
  /** Whether the proposal's tool moved into it. */
  movedTool: boolean;
}

/**
 * Decide one proposal, in one transaction.
 *
 * - **accept** (`new_category` only): create the category — its name and
 *   parent as the reviewer left them, a fresh unique slug — and move the
 *   subject tool into it, but only if the tool is still where approval put it
 *   (its nearest existing category, or none): a tool somebody moved since
 *   stays where they moved it.
 * - **merge**: for `new_category`, the subject tool goes to `targetCategoryId`
 *   instead (same caveat); for `review_category`, the flagged category is
 *   merged into it ({@link mergeCategoriesIn}).
 * - **reject**: nothing but the status.
 */
export async function decideCategoryProposal(
  db: Db,
  input: DecideProposalInput
): Promise<TaxonomyResult<DecideProposalValue>> {
  if (!isUuid(input.proposalId)) return { ok: false, reason: "not_found" };
  return db.transaction(async (tx) => {
    const [proposal] = await tx.select().from(categoryProposals).where(eq(categoryProposals.id, input.proposalId)).for("update");
    if (!proposal) return { ok: false, reason: "not_found" } as const;
    if (proposal.status !== "pending") return { ok: false, reason: "already_decided" } as const;

    const finish = async (status: CategoryProposalStatus, categoryId: string | null) => {
      await tx
        .update(categoryProposals)
        .set({ status, resultingCategoryId: categoryId, decidedBy: input.actorUserId ?? null, decidedAt: sql`now()` })
        .where(eq(categoryProposals.id, proposal.id));
    };

    if (input.decision === "reject") {
      await finish("rejected", null);
      return { ok: true, status: "rejected", categoryId: null, movedTool: false } as const;
    }

    if (input.decision === "accept") {
      if (proposal.kind !== "new_category") return { ok: false, reason: "invalid_decision" } as const;
      const name = clean(input.name ?? proposal.name, CATEGORY_NAME_MAX);
      if (!name) return { ok: false, reason: "invalid_field" } as const;
      const parentId = input.parentId !== undefined ? input.parentId : proposal.parentId;
      if (parentId) {
        if (!isUuid(parentId)) return { ok: false, reason: "invalid_field" } as const;
        const [parent] = await tx.select({ id: categories.id, retiredAt: categories.retiredAt, parentId: categories.parentId }).from(categories).where(eq(categories.id, parentId));
        if (!parent) return { ok: false, reason: "not_found" } as const;
        if (parent.retiredAt) return { ok: false, reason: "retired_target" } as const;
        // Two levels, no more: a parent must itself be top-level.
        if (parent.parentId) return { ok: false, reason: "invalid_field" } as const;
      }
      const description = input.description !== undefined ? clean(input.description, CATEGORY_DESCRIPTION_MAX) : proposal.description;
      const created = await insertCategory(tx, { name, parentId: parentId ?? null, description });
      if (!created.ok) return created;
      const movedTool = await moveSubjectTool(tx, proposal, created.id, input.actorUserId ?? null);
      await finish("accepted", created.id);
      return { ok: true, status: "accepted", categoryId: created.id, movedTool } as const;
    }

    // merge
    const targetId = input.targetCategoryId ?? proposal.nearestExistingId;
    if (!targetId || !isUuid(targetId)) return { ok: false, reason: "invalid_field" } as const;
    const [target] = await tx.select({ id: categories.id, retiredAt: categories.retiredAt }).from(categories).where(eq(categories.id, targetId));
    if (!target) return { ok: false, reason: "not_found" } as const;
    if (target.retiredAt) return { ok: false, reason: "retired_target" } as const;
    if (proposal.kind === "review_category") {
      if (proposal.subjectType !== "category" || !proposal.subjectId) return { ok: false, reason: "invalid_decision" } as const;
      const merged = await mergeCategoriesIn(tx, { fromId: proposal.subjectId, intoId: target.id, actorUserId: input.actorUserId ?? null });
      if (!merged.ok) return merged;
      await finish("merged", target.id);
      return { ok: true, status: "merged", categoryId: target.id, movedTool: false } as const;
    }
    const movedTool = await moveSubjectTool(tx, proposal, target.id, input.actorUserId ?? null);
    await finish("merged", target.id);
    return { ok: true, status: "merged", categoryId: target.id, movedTool } as const;
  });
}

/** Insert a category with a slug nobody holds; a name taken under the same parent is `duplicate_name`. */
async function insertCategory(
  db: Db,
  input: { name: string; parentId: string | null; description: string | null }
): Promise<{ ok: true; id: string; slug: string } | { ok: false; reason: TaxonomyWriteError }> {
  const base = categorySlug(input.name);
  const taken = new Set(
    (await db.select({ slug: categories.slug }).from(categories).where(sql`${categories.slug} = ${base} or ${categories.slug} like ${`${base}-%`}`)).map((row) => row.slug)
  );
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${categories.sortOrder}), 0)::int` })
    .from(categories)
    .where(input.parentId ? eq(categories.parentId, input.parentId) : isNull(categories.parentId));
  try {
    const [row] = await db.transaction(async (savepoint) =>
      savepoint
        .insert(categories)
        .values({ name: input.name, slug, parentId: input.parentId, description: input.description, sortOrder: Number(max) + 10 })
        .returning({ id: categories.id })
    );
    return { ok: true, id: row.id, slug };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "duplicate_name" };
    throw error;
  }
}

/** Move a proposal's subject tool into `categoryId` if it is still where approval left it. */
async function moveSubjectTool(
  db: Db,
  proposal: { subjectType: string | null; subjectId: string | null; nearestExistingId: string | null },
  categoryId: string,
  actorUserId: string | null
): Promise<boolean> {
  if (proposal.subjectType !== "tool" || !proposal.subjectId || !isUuid(proposal.subjectId)) return false;
  const stillThere = proposal.nearestExistingId ? eq(tools.categoryId, proposal.nearestExistingId) : isNull(tools.categoryId);
  const moved = await db
    .update(tools)
    .set({ categoryId, updatedBy: actorUserId })
    .where(and(eq(tools.id, proposal.subjectId), stillThere))
    .returning({ id: tools.id });
  return moved.length > 0;
}

// ── Merging, editing, retiring ──────────────────────────────────────

/** Merge `fromId` into `intoId`: its tools move, it is retired with `merged_into_id`. One transaction. */
export async function mergeCategories(
  db: Db,
  input: { fromId: string; intoId: string; actorUserId?: string | null }
): Promise<TaxonomyResult<{ movedTools: number }>> {
  return db.transaction((tx) => mergeCategoriesIn(tx, input));
}

async function mergeCategoriesIn(
  db: Db,
  input: { fromId: string; intoId: string; actorUserId?: string | null }
): Promise<TaxonomyResult<{ movedTools: number }>> {
  if (!isUuid(input.fromId) || !isUuid(input.intoId)) return { ok: false, reason: "not_found" };
  if (input.fromId === input.intoId) return { ok: false, reason: "invalid_field" };
  const rows = await db
    .select({ id: categories.id, retiredAt: categories.retiredAt, parentId: categories.parentId })
    .from(categories)
    .where(inArray(categories.id, [input.fromId, input.intoId]))
    .for("update");
  const from = rows.find((row) => row.id === input.fromId);
  const into = rows.find((row) => row.id === input.intoId);
  if (!from || !into) return { ok: false, reason: "not_found" };
  if (from.retiredAt) return { ok: false, reason: "already_decided" };
  if (into.retiredAt) return { ok: false, reason: "retired_target" };
  if (into.parentId === from.id) return { ok: false, reason: "invalid_field" };
  const [children] = await db
    .select({ n: count() })
    .from(categories)
    .where(and(eq(categories.parentId, from.id), isNull(categories.retiredAt)));
  if ((children?.n ?? 0) > 0) return { ok: false, reason: "has_children" };

  const moved = await db
    .update(tools)
    .set({ categoryId: into.id, updatedBy: input.actorUserId ?? null })
    .where(eq(tools.categoryId, from.id))
    .returning({ id: tools.id });
  await db.update(categories).set({ retiredAt: sql`now()`, mergedIntoId: into.id, updatedBy: input.actorUserId ?? null }).where(eq(categories.id, from.id));
  // Proposals waiting on the merged category now point at where it went.
  await db
    .update(categoryProposals)
    .set({ nearestExistingId: into.id })
    .where(and(eq(categoryProposals.status, "pending"), eq(categoryProposals.nearestExistingId, from.id)));
  return { ok: true, movedTools: moved.length };
}

/** Rename, re-describe or re-order one category. A name taken under the same parent is `duplicate_name`. */
export async function editCategory(
  db: Db,
  input: { id: string; name?: string; description?: string | null; sortOrder?: number; galleryHidden?: boolean; actorUserId?: string | null }
): Promise<TaxonomyResult<{ name: string }>> {
  if (!isUuid(input.id)) return { ok: false, reason: "not_found" };
  const set: Partial<typeof categories.$inferInsert> = { updatedBy: input.actorUserId ?? null };
  if (input.name !== undefined) {
    const name = clean(input.name, CATEGORY_NAME_MAX + 1);
    if (!name || name.length > CATEGORY_NAME_MAX) return { ok: false, reason: "invalid_field" };
    set.name = name;
  }
  if (input.description !== undefined) {
    if ((input.description ?? "").trim().length > CATEGORY_DESCRIPTION_MAX) return { ok: false, reason: "invalid_field" };
    set.description = clean(input.description, CATEGORY_DESCRIPTION_MAX);
  }
  if (input.sortOrder !== undefined) {
    if (!Number.isInteger(input.sortOrder) || input.sortOrder < 0 || input.sortOrder > 100000) return { ok: false, reason: "invalid_field" };
    set.sortOrder = input.sortOrder;
  }
  if (input.galleryHidden !== undefined) set.galleryHidden = input.galleryHidden;
  try {
    const [row] = await db.update(categories).set(set).where(eq(categories.id, input.id)).returning({ name: categories.name });
    if (!row) return { ok: false, reason: "not_found" };
    return { ok: true, name: row.name };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "duplicate_name" };
    throw error;
  }
}

/**
 * Retire a category (it leaves every select and research's list) or restore
 * one. Retiring refuses while a live tool or a live child is in it — merge
 * instead, which says where the tools went. Restoring clears `merged_into_id`.
 */
export async function setCategoryRetired(
  db: Db,
  input: { id: string; retired: boolean; actorUserId?: string | null }
): Promise<TaxonomyResult> {
  if (!isUuid(input.id)) return { ok: false, reason: "not_found" };
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ id: categories.id, retiredAt: categories.retiredAt }).from(categories).where(eq(categories.id, input.id)).for("update");
    if (!row) return { ok: false, reason: "not_found" } as const;
    if (input.retired) {
      const [live] = await tx.select({ n: count() }).from(tools).where(and(eq(tools.categoryId, row.id), isNull(tools.archivedAt)));
      if ((live?.n ?? 0) > 0) return { ok: false, reason: "not_empty" } as const;
      const [children] = await tx.select({ n: count() }).from(categories).where(and(eq(categories.parentId, row.id), isNull(categories.retiredAt)));
      if ((children?.n ?? 0) > 0) return { ok: false, reason: "has_children" } as const;
      await tx.update(categories).set({ retiredAt: row.retiredAt ?? sql`now()`, updatedBy: input.actorUserId ?? null }).where(eq(categories.id, row.id));
    } else {
      await tx.update(categories).set({ retiredAt: null, mergedIntoId: null, updatedBy: input.actorUserId ?? null }).where(eq(categories.id, row.id));
    }
    return { ok: true } as const;
  });
}
