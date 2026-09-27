import type { CategoryOption } from "../data/taxonomy.ts";

/**
 * The research step's proposed category, resolved against the taxonomy that
 * already exists (spec §3.7: "resolve category and location against the
 * taxonomy").
 *
 * The model names a category in its own words; the preliminary page wants to
 * preselect a real one when there is one, and to offer "create this category"
 * only when there is not. So this answers one question — *which existing
 * category did the model mean?* — and answers "none" whenever it cannot be
 * sure. A wrong preselection is worse than an empty one: the reviewer has to
 * notice it to fix it.
 *
 * Pure, and it creates nothing. Creating a category is approval's business
 * (`findOrCreateCategory`, behind `tools.approve`).
 */

export interface ProposedCategory {
  name: string;
  group: string | null;
}

export interface MatchedCategory {
  name: string;
  group: string | null;
  existingId: string | null;
}

/** Case, surrounding space and runs of space do not make two categories different. */
function key(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * `proposed` with `existingId` set when it names an existing category.
 *
 * - **Name and group both match** — that category.
 * - **Exactly one category has the name, and the model's group does not
 *   contradict it** (it gave none, or the stored category has none) — that
 *   one. "Resin" means the "Resin" under "3D Printing" when there is only one
 *   "Resin".
 * - **Otherwise** — no match. Guessing between "Laser › Accessories" and
 *   "Printing › Accessories", or reading "Printing › Accessories" as the only
 *   "Laser › Accessories", is the wrong preselection this module exists to
 *   avoid.
 *
 * A match answers with the *stored* spelling, so the page shows the taxonomy's
 * name, not the model's paraphrase of it. No match keeps the model's words for
 * the reviewer to accept or change.
 */
export function matchCategory(
  proposed: ProposedCategory | null,
  categories: readonly CategoryOption[]
): MatchedCategory {
  const name = proposed?.name.trim() ?? "";
  const group = proposed?.group?.trim() || null;
  if (!name) return { name: "", group, existingId: null };

  const sameName = categories.filter((category) => key(category.name) === key(name));
  const exact = sameName.find((category) => key(category.group) === key(group));
  const chosen = exact ?? (sameName.length === 1 && !groupNamesOther(group, sameName[0]) ? sameName[0] : null);

  if (!chosen) return { name, group, existingId: null };
  return { name: chosen.name, group: chosen.group, existingId: chosen.id };
}

/**
 * The model said a group, and it is a *different* group from the one
 * candidate's. "Accessories" under "Laser" is not the "Accessories" the model
 * meant when it said "Printing" — unless the stored one has no group at all,
 * in which case the model's group is extra detail, not a contradiction.
 */
function groupNamesOther(group: string | null, candidate: CategoryOption): boolean {
  return group !== null && candidate.group !== null && key(group) !== key(candidate.group);
}
