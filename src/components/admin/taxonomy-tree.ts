/**
 * The view model behind `/admin/taxonomy` (taxonomy v2 spec §5.3): the flat
 * category rows arranged as the two-level tree, each with its tools and
 * counts. Pure and directive-free, so the island and its tests share it.
 */

export interface TaxonomyCategoryRow {
  id: string;
  slug: string;
  name: string;
  group: string | null;
  description: string | null;
  parentId: string | null;
  sortOrder: number;
  galleryHidden: boolean;
  retiredAt: Date | string | null;
  mergedIntoId: string | null;
  toolCount: number;
}

export interface TaxonomyToolRow {
  id: string;
  slug: string;
  name: string;
  revision: string;
  categoryId: string | null;
}

export interface TaxonomyNodeView {
  category: TaxonomyCategoryRow;
  children: TaxonomyNodeView[];
  tools: TaxonomyToolRow[];
  /** This category's tools plus its children's. */
  total: number;
}

export interface TaxonomyTreeView {
  /** Live top-level categories (v2) in order, each with its live children. */
  roots: TaxonomyNodeView[];
  /** Live pre-v2 rows still carrying a free-text group — what `taxonomy:migrate` has not retired yet. */
  legacy: TaxonomyNodeView[];
  retired: TaxonomyCategoryRow[];
  /** Tools in no category. */
  uncategorized: TaxonomyToolRow[];
}

const byOrder = (a: TaxonomyCategoryRow, b: TaxonomyCategoryRow) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

export function buildTaxonomyTree(categories: readonly TaxonomyCategoryRow[], tools: readonly TaxonomyToolRow[]): TaxonomyTreeView {
  const toolsBy = new Map<string, TaxonomyToolRow[]>();
  const uncategorized: TaxonomyToolRow[] = [];
  for (const tool of tools) {
    if (!tool.categoryId) uncategorized.push(tool);
    else toolsBy.set(tool.categoryId, [...(toolsBy.get(tool.categoryId) ?? []), tool]);
  }
  const live = categories.filter((category) => !category.retiredAt);
  const node = (category: TaxonomyCategoryRow): TaxonomyNodeView => {
    const children = live.filter((child) => child.parentId === category.id).sort(byOrder).map(node);
    const own = (toolsBy.get(category.id) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
    return { category, children, tools: own, total: category.toolCount + children.reduce((sum, child) => sum + child.total, 0) };
  };
  const liveIds = new Set(live.map((category) => category.id));
  const tops = live.filter((category) => !category.parentId || !liveIds.has(category.parentId));
  return {
    roots: tops.filter((category) => category.group === null).sort(byOrder).map(node),
    legacy: tops
      .filter((category) => category.group !== null)
      .sort((a, b) => (a.group ?? "").localeCompare(b.group ?? "") || a.name.localeCompare(b.name))
      .map(node),
    retired: categories.filter((category) => category.retiredAt).sort((a, b) => a.name.localeCompare(b.name)),
    uncategorized: uncategorized.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** `Parent › Name` for a live category, or its name; pre-v2 rows use their group. */
export function categoryPathLabel(category: Pick<TaxonomyCategoryRow, "name" | "group" | "parentId">, byId: ReadonlyMap<string, Pick<TaxonomyCategoryRow, "name">>): string {
  const parent = category.parentId ? byId.get(category.parentId) : undefined;
  const head = parent?.name ?? category.group;
  return head ? `${head} › ${category.name}` : category.name;
}

/** The categories a tool or a merge can go to: live ones, as `{ id, label }`, in tree order. */
export function categoryChoices(tree: TaxonomyTreeView): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  const walk = (nodes: TaxonomyNodeView[], head: string | null) => {
    for (const entry of nodes) {
      out.push({ id: entry.category.id, label: head ? `${head} › ${entry.category.name}` : entry.category.name });
      walk(entry.children, entry.category.name);
    }
  };
  walk(tree.roots, null);
  for (const entry of tree.legacy) out.push({ id: entry.category.id, label: `${entry.category.group} › ${entry.category.name}` });
  return out;
}
