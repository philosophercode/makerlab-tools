import { asc, eq, inArray, sql } from "drizzle-orm";
import { categories, tools } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import { moveFor, oldCategoryKey, OLD_CATEGORY_MOVES, type MoveRule } from "./mapping.ts";
import { flattenTree, TAXONOMY_TREE, type FlatTaxonomyNode, type TaxonomyNode } from "./tree.ts";

/**
 * The one-off recategorisation (`npm run taxonomy:migrate`; taxonomy v2 spec
 * §5.1): create the v2 tree, move every tool per `mapping.ts`, set the two
 * facets where they are still the defaults, and retire every old category
 * left empty (`merged_into_id` = where most of its tools went).
 *
 * **Deterministic and idempotent.** The plan is a pure function of the rows
 * ({@link planTaxonomyMigration}); run twice, the second plan is empty. A
 * category the tree names is found by slug — a pre-v2 row that happens to
 * hold one of the tree's slugs keeps its row and gets `-legacy` appended, so
 * the tree's slug means the tree's category. Names and descriptions somebody
 * edited since are never overwritten; only blanks are filled.
 *
 * Relative imports with `.ts` extensions: `scripts/` runs this under plain Node.
 */

export interface SnapshotCategory {
  id: string;
  slug: string;
  name: string;
  group: string | null;
  description: string | null;
  parentId: string | null;
  sortOrder: number;
  galleryHidden: boolean;
  retiredAt: Date | null;
}

export interface SnapshotTool {
  id: string;
  slug: string;
  name: string;
  categoryId: string | null;
  itemKind: string;
  parentToolId: string | null;
  archived: boolean;
}

export interface TaxonomySnapshot {
  categories: SnapshotCategory[];
  tools: SnapshotTool[];
}

export interface PlannedCategory extends FlatTaxonomyNode {
  /** `create` a new row, `update` the existing one's tree columns (and blank text), or nothing to do. */
  action: "create" | "update" | "keep";
  existingId: string | null;
  /** Which columns an update changes, for the printout. */
  changes: string[];
}

export interface PlannedMove {
  toolId: string;
  toolSlug: string;
  toolName: string;
  from: string | null;
  to: string;
  rule: MoveRule;
  itemKind: string | null;
  parentToolSlug: string | null;
}

export interface PlannedRetirement {
  categoryId: string;
  label: string;
  mergedIntoSlug: string | null;
}

export interface TaxonomyPlan {
  /** Pre-v2 rows holding a tree slug, renamed out of the way first. */
  legacySlugRenames: { categoryId: string; from: string; to: string }[];
  categories: PlannedCategory[];
  moves: PlannedMove[];
  /** Tools already in the right place (no write), by count. */
  alreadyPlaced: number;
  /** Tools no rule places: left where they are, for a person. */
  unmapped: { toolSlug: string; toolName: string; from: string | null }[];
  /** Facet writes on tools that are not moving (the category was already right). */
  facets: { toolId: string; toolSlug: string; itemKind: string | null; parentToolSlug: string | null }[];
  retirements: PlannedRetirement[];
}

/** Read what the plan is a function of. Archived tools included: they keep a category too. */
export async function readTaxonomySnapshot(db: Db): Promise<TaxonomySnapshot> {
  const categoryRows = await db
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
    })
    .from(categories)
    .orderBy(asc(categories.slug));
  const toolRows = await db
    .select({
      id: tools.id,
      slug: tools.slug,
      name: tools.name,
      categoryId: tools.categoryId,
      itemKind: tools.itemKind,
      parentToolId: tools.parentToolId,
      archivedAt: tools.archivedAt,
    })
    .from(tools)
    .orderBy(asc(tools.slug));
  return {
    categories: categoryRows,
    tools: toolRows.map(({ archivedAt, ...tool }) => ({ ...tool, archived: archivedAt !== null })),
  };
}

function label(category: Pick<SnapshotCategory, "name" | "group"> | undefined, parentName?: string | null): string {
  if (!category) return "(none)";
  const head = parentName ?? category.group;
  return head ? `${head} › ${category.name}` : category.name;
}

/**
 * The plan for `snapshot`. Pure: the same rows always give the same plan, in
 * the same order (tree order for categories, slug order for tools).
 */
export function planTaxonomyMigration(snapshot: TaxonomySnapshot, tree: readonly TaxonomyNode[] = TAXONOMY_TREE): TaxonomyPlan {
  const flat = flattenTree(tree);
  const treeSlugs = new Set(flat.map((node) => node.slug));
  const bySlug = new Map(snapshot.categories.map((category) => [category.slug, category]));
  const byId = new Map(snapshot.categories.map((category) => [category.id, category]));

  // 1. A pre-v2 row (it has a group) holding a tree slug is not the tree's category.
  const legacySlugRenames: TaxonomyPlan["legacySlugRenames"] = [];
  const taken = new Set(snapshot.categories.map((category) => category.slug));
  for (const node of flat) {
    const holder = bySlug.get(node.slug);
    if (holder && holder.group !== null) {
      let to = `${node.slug}-legacy`;
      for (let n = 2; taken.has(to); n++) to = `${node.slug}-legacy-${n}`;
      taken.add(to);
      legacySlugRenames.push({ categoryId: holder.id, from: node.slug, to });
      bySlug.delete(node.slug);
    }
  }

  // 2. The tree, parents first.
  const planned: PlannedCategory[] = flat.map((node) => {
    const existing = bySlug.get(node.slug);
    if (!existing) return { ...node, action: "create", existingId: null, changes: [] };
    // Only what is missing: a parent, a description, an order, the hidden flag. A
    // name, a description or a parent somebody chose since is theirs.
    const changes: string[] = [];
    if (node.parentSlug && existing.parentId === null) changes.push("parent");
    if (!existing.description?.trim()) changes.push("description");
    if (existing.sortOrder === 0) changes.push("sort order");
    if (node.galleryHidden && !existing.galleryHidden) changes.push("gallery hidden");
    return { ...node, action: changes.length ? "update" : "keep", existingId: existing.id, changes };
  });

  // 3. Tools.
  const toolsBySlug = new Map(snapshot.tools.map((tool) => [tool.slug, tool]));
  const moves: PlannedMove[] = [];
  const facets: TaxonomyPlan["facets"] = [];
  const unmapped: TaxonomyPlan["unmapped"] = [];
  let alreadyPlaced = 0;
  const destinations = new Map<string, Map<string, number>>();

  for (const tool of snapshot.tools) {
    const current = tool.categoryId ? byId.get(tool.categoryId) : undefined;
    const currentParent = current?.parentId ? byId.get(current.parentId) : undefined;
    const fromLabel = current ? label(current, currentParent?.name) : null;
    const inTree = current !== undefined && treeSlugs.has(current.slug) && current.group === null;

    const found = moveFor({
      slug: tool.slug,
      name: tool.name,
      categoryName: current?.name ?? null,
      categoryGroup: current?.group ?? null,
    });

    const facetKind = found?.move.itemKind && tool.itemKind === "equipment" ? found.move.itemKind : null;
    const parentSlug =
      found?.move.parentSlug && tool.parentToolId === null && toolsBySlug.has(found.move.parentSlug) && found.move.parentSlug !== tool.slug
        ? found.move.parentSlug
        : null;

    if (!found) {
      if (inTree) alreadyPlaced++;
      else unmapped.push({ toolSlug: tool.slug, toolName: tool.name, from: fromLabel });
      continue;
    }
    // Already in the tree: a person (or an earlier run) placed it. Never moved again.
    if (inTree) {
      alreadyPlaced++;
      if (facetKind || parentSlug) facets.push({ toolId: tool.id, toolSlug: tool.slug, itemKind: facetKind, parentToolSlug: parentSlug });
      continue;
    }
    moves.push({
      toolId: tool.id,
      toolSlug: tool.slug,
      toolName: tool.name,
      from: fromLabel,
      to: found.move.category,
      rule: found.rule,
      itemKind: facetKind,
      parentToolSlug: parentSlug,
    });
    if (current) {
      const counts = destinations.get(current.id) ?? new Map<string, number>();
      counts.set(found.move.category, (counts.get(found.move.category) ?? 0) + 1);
      destinations.set(current.id, counts);
    }
  }

  // 4. Old categories left empty: every pre-v2 row not retired and holding no tool after the moves.
  const movingOut = new Set(moves.map((move) => move.toolId));
  const staying = new Map<string, number>();
  for (const tool of snapshot.tools) {
    if (tool.categoryId && !movingOut.has(tool.id)) staying.set(tool.categoryId, (staying.get(tool.categoryId) ?? 0) + 1);
  }
  // A pre-v2 row is one with a group (the import's shape), or an ungrouped
  // top-level row this run moved tools out of. A row under a tree category, or
  // an ungrouped one nobody's tools left, is somebody's since: never retired.
  const isPreV2 = (category: SnapshotCategory) =>
    category.group !== null || (category.parentId === null && !treeSlugs.has(category.slug) && destinations.has(category.id));
  const retirements: PlannedRetirement[] = snapshot.categories
    .filter((category) => category.retiredAt === null && isPreV2(category))
    .filter((category) => (staying.get(category.id) ?? 0) === 0)
    .map((category) => ({
      categoryId: category.id,
      label: label(category),
      mergedIntoSlug: mostCommon(destinations.get(category.id)) ?? OLD_CATEGORY_MOVES[oldCategoryKey(category.group, category.name)] ?? null,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return { legacySlugRenames, categories: planned, moves, alreadyPlaced, unmapped, facets, retirements };
}

function mostCommon(counts: Map<string, number> | undefined): string | null {
  if (!counts || counts.size === 0) return null;
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

/** True when there is nothing to write. */
export function planIsEmpty(plan: TaxonomyPlan): boolean {
  return (
    plan.legacySlugRenames.length === 0 &&
    plan.categories.every((category) => category.action === "keep") &&
    plan.moves.length === 0 &&
    plan.facets.length === 0 &&
    plan.retirements.length === 0
  );
}

export interface ApplyReport {
  created: number;
  updated: number;
  moved: number;
  /** Of the moved tools, how many had a facet written with the move (item kind or parent). */
  movedWithFacets: number;
  /** Facet writes on tools that did not move (already in the tree). */
  facets: number;
  retired: number;
}

/**
 * Write `plan` in one transaction: legacy slugs, the tree (parents first),
 * the moves and facets, then the retirements. Re-reads nothing: run it on the
 * plan just made from the same handle. Any failure rolls every write back.
 */
export async function applyTaxonomyPlan(db: Db, plan: TaxonomyPlan): Promise<ApplyReport> {
  const report: ApplyReport = { created: 0, updated: 0, moved: 0, movedWithFacets: 0, facets: 0, retired: 0 };
  await db.transaction(async (tx) => {
    for (const rename of plan.legacySlugRenames) {
      await tx.update(categories).set({ slug: rename.to }).where(eq(categories.id, rename.categoryId));
    }

    const ids = new Map<string, string>();
    for (const node of plan.categories) {
      const parentId = node.parentSlug ? ids.get(node.parentSlug) ?? null : null;
      if (node.action === "create") {
        const [row] = await tx
          .insert(categories)
          .values({
            slug: node.slug,
            name: node.name,
            group: null,
            description: node.description,
            parentId,
            sortOrder: node.sortOrder,
            galleryHidden: node.galleryHidden,
          })
          .returning({ id: categories.id });
        ids.set(node.slug, row.id);
        report.created++;
        continue;
      }
      const id = node.existingId as string;
      ids.set(node.slug, id);
      if (node.action === "update") {
        const set: Partial<typeof categories.$inferInsert> = {};
        if (node.changes.includes("parent")) set.parentId = parentId;
        if (node.changes.includes("description")) set.description = node.description;
        if (node.changes.includes("sort order")) set.sortOrder = node.sortOrder;
        if (node.changes.includes("gallery hidden")) set.galleryHidden = true;
        await tx.update(categories).set(set).where(eq(categories.id, id));
        report.updated++;
      }
    }

    const toolIdBySlug = new Map<string, string>();
    const parentSlugs = [...plan.moves, ...plan.facets].map((entry) => entry.parentToolSlug).filter((slug): slug is string => Boolean(slug));
    if (parentSlugs.length) {
      const rows = await tx.select({ id: tools.id, slug: tools.slug }).from(tools).where(inArray(tools.slug, parentSlugs));
      for (const row of rows) toolIdBySlug.set(row.slug, row.id);
    }

    for (const move of plan.moves) {
      const categoryId = ids.get(move.to);
      if (!categoryId) throw new Error(`taxonomy:migrate: ${move.to} is not in the tree`);
      await tx
        .update(tools)
        .set({
          categoryId,
          ...(move.itemKind ? { itemKind: move.itemKind } : {}),
          ...(move.parentToolSlug && toolIdBySlug.get(move.parentToolSlug) ? { parentToolId: toolIdBySlug.get(move.parentToolSlug) } : {}),
        })
        .where(eq(tools.id, move.toolId));
      report.moved++;
      if (move.itemKind || move.parentToolSlug) report.movedWithFacets++;
    }

    for (const facet of plan.facets) {
      await tx
        .update(tools)
        .set({
          ...(facet.itemKind ? { itemKind: facet.itemKind } : {}),
          ...(facet.parentToolSlug && toolIdBySlug.get(facet.parentToolSlug) ? { parentToolId: toolIdBySlug.get(facet.parentToolSlug) } : {}),
        })
        .where(eq(tools.id, facet.toolId));
      report.facets++;
    }

    for (const retirement of plan.retirements) {
      await tx
        .update(categories)
        .set({
          retiredAt: sql`now()`,
          mergedIntoId: retirement.mergedIntoSlug ? ids.get(retirement.mergedIntoSlug) ?? null : null,
        })
        .where(eq(categories.id, retirement.categoryId));
      report.retired++;
    }
  });
  return report;
}

/** Moves that also write a facet (item kind or parent tool). */
export function movesWithFacets(plan: TaxonomyPlan): number {
  return plan.moves.filter((move) => move.itemKind || move.parentToolSlug).length;
}

/**
 * The apply report as the one line `taxonomy:migrate` prints. Facets written
 * with a move are said with the move — "0 facet updates" alone once read as
 * "no facets were set" when every one had ridden along with its move.
 */
export function formatApplyReport(report: ApplyReport): string {
  return (
    `Written: ${report.created} categories created, ${report.updated} updated, ` +
    `${report.moved} tools moved (${report.movedWithFacets} with facets), ` +
    `${report.facets} facet updates on tools already placed, ${report.retired} old categories retired.`
  );
}

/** The plan as the lines `taxonomy:migrate` prints. */
export function formatTaxonomyPlan(plan: TaxonomyPlan): string[] {
  const lines: string[] = [];
  if (plan.legacySlugRenames.length) {
    lines.push("Old categories holding a tree slug (renamed first):");
    for (const rename of plan.legacySlugRenames) lines.push(`  ${rename.from} → ${rename.to}`);
  }
  const creating = plan.categories.filter((category) => category.action === "create");
  const updating = plan.categories.filter((category) => category.action === "update");
  lines.push(`Categories: ${creating.length} to create, ${updating.length} to update, ${plan.categories.length - creating.length - updating.length} already in place.`);
  for (const category of plan.categories) {
    if (category.action === "keep") continue;
    const indent = category.parentSlug ? "    " : "  ";
    const hidden = category.galleryHidden && !category.parentSlug ? " (hidden from the public gallery)" : "";
    const what = category.action === "create" ? "+" : `~ (${category.changes.join(", ")})`;
    lines.push(`${indent}${what} ${category.slug} — ${category.name}${hidden}`);
  }
  lines.push(`Tools: ${plan.moves.length} to move, ${plan.alreadyPlaced} already placed, ${plan.unmapped.length} unmapped.`);
  lines.push(`Facets: ${movesWithFacets(plan)} set with a move, ${plan.facets.length} on tools already placed.`);
  for (const move of plan.moves) {
    const facets = [move.itemKind ? `kind ${move.itemKind}` : null, move.parentToolSlug ? `accessory of ${move.parentToolSlug}` : null].filter(Boolean);
    lines.push(`  ${move.toolSlug}: ${move.from ?? "(none)"} → ${move.to} [${move.rule}]${facets.length ? ` (${facets.join(", ")})` : ""}`);
  }
  if (plan.facets.length) {
    lines.push(`Facets on tools already placed: ${plan.facets.length}.`);
    for (const facet of plan.facets) {
      lines.push(`  ${facet.toolSlug}: ${[facet.itemKind ? `kind ${facet.itemKind}` : null, facet.parentToolSlug ? `accessory of ${facet.parentToolSlug}` : null].filter(Boolean).join(", ")}`);
    }
  }
  if (plan.unmapped.length) {
    lines.push("Unmapped (left where they are — place them on /admin/taxonomy or in the editor):");
    for (const tool of plan.unmapped) lines.push(`  ${tool.toolSlug} (${tool.toolName}) in ${tool.from ?? "(none)"}`);
  }
  lines.push(`Old categories to retire: ${plan.retirements.length}.`);
  for (const retirement of plan.retirements) lines.push(`  ${retirement.label} → merged into ${retirement.mergedIntoSlug ?? "(nothing)"}`);
  return lines;
}
