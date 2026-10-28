import { sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { categories } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import { listCategories, type CategoryOption } from "../data/taxonomy.ts";
import { flattenTree, TAXONOMY_TREE, type TaxonomyNode } from "./tree.ts";

/**
 * The default category tree on a lab that has none (assistant cleanup spec
 * 2026-10-28 §2).
 *
 * `TAXONOMY_TREE` used to reach a database only through
 * `npm run taxonomy:migrate` (or the built-in demo seed). A lab created after
 * that — the demo deployment on its own Neon database, a fresh fork — had an
 * empty `categories` table, so research had no slug to answer with, approval
 * saved every tool uncategorized and filed its guess as a proposal, and the
 * assistant had nothing `recategorize_tool` could name.
 *
 * - **Only an empty table is seeded.** Any category row at all, live or
 *   retired, means somebody has a taxonomy: it is never touched. A lab that
 *   retired every category keeps that choice.
 * - **Idempotent and race-safe**: one transaction, parents before children,
 *   and a slug that already exists (two requests seeding at once) is skipped.
 * - Called before the reads that choose a category — research's prompt,
 *   approval's draft, the assistant's category tools, the editing pages — not
 *   inside `listCategories`, which tests and scripts call on purpose-built
 *   tables.
 * - Remembered per database handle once the table has rows, so the check is
 *   one `limit 1` read per cold start, not per request.
 *
 * Plain Node: no `"server-only"`, relative `.ts` imports.
 */

/** Handles whose `categories` table is known to have rows. */
const seeded = new WeakSet<object>();

export interface SeedReport {
  /** Rows written: 0 when the lab already had categories. */
  inserted: number;
}

export async function ensureDefaultTaxonomy(
  options: { db?: Db; tree?: readonly TaxonomyNode[] } = {}
): Promise<SeedReport> {
  const db = options.db ?? (await getDb());
  if (seeded.has(db)) return { inserted: 0 };

  const inserted = await db.transaction(async (tx) => {
    const [any] = await tx.select({ one: sql<number>`1` }).from(categories).limit(1);
    if (any) return 0;
    const ids = new Map<string, string>();
    let count = 0;
    for (const node of flattenTree(options.tree ?? TAXONOMY_TREE)) {
      const parentId = node.parentSlug ? (ids.get(node.parentSlug) ?? null) : null;
      if (node.parentSlug && !parentId) continue;
      const [row] = await tx
        .insert(categories)
        .values({
          slug: node.slug,
          name: node.name,
          description: node.description,
          parentId,
          sortOrder: node.sortOrder,
          galleryHidden: node.galleryHidden,
        })
        .onConflictDoNothing()
        .returning({ id: categories.id });
      if (row) {
        ids.set(node.slug, row.id);
        count += 1;
      }
    }
    return count;
  });

  seeded.add(db);
  if (inserted > 0) console.info(`[taxonomy] seeded the default category tree (${inserted} categories) on an empty lab`);
  return { inserted };
}

/**
 * The live categories for a surface that chooses one, after making sure the
 * lab has its default tree. A failed seed is logged and the list read anyway:
 * choosing a category must never fail because seeding did.
 */
export async function listCategoriesForChoosing(): Promise<CategoryOption[]> {
  try {
    await ensureDefaultTaxonomy();
  } catch (error) {
    console.warn(`[taxonomy] could not seed the default tree: ${error instanceof Error ? error.message : String(error)}`);
  }
  return listCategories();
}
